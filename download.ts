import { Komikku } from "@weismanns/komikku";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// ---------- CONFIG ----------
const args = process.argv.slice(2);
const VERIFY = args.includes("--verify");
const pos = args.filter(a => !a.startsWith("--"));

if (!pos[0] || !pos[0].trim()) {
  console.error("Usage: npm run download -- \"<Series Name>\" [from] [to] [outDir] [--verify]");
  console.error("");
  console.error("  <Series Name>  Title as shown on DemonicScans (required)");
  console.error("  [from]         First chapter number (default: 0)");
  console.error("  [to]           Last chapter number (default: all)");
  console.error("  [outDir]       Output directory (default: ./downloads)");
  console.error("  [--verify]     Re-check completed chapters for re-uploads");
  console.error("");
  console.error("  Example: npm run download -- \"Overgeared\" 1 10");
  process.exit(1);
}

const SERIES_NAME = pos[0].trim();
const CHAPTER_FROM = pos[1] ? Number(pos[1]) : 0;
const CHAPTER_TO = pos[2] ? Number(pos[2]) : Infinity;
const OUTPUT_DIR = pos[3] ?? "./downloads";
const PROVIDER = "Demonicscans";
const BASE = "https://demonicscans.org";
const DELAY_MS = 500;
const RETRIES = 3;
const MIN_FILE_SIZE = 100;
const MARKER = ".complete";

if (pos[1] && isNaN(CHAPTER_FROM)) { console.error(`Invalid CHAPTER_FROM: ${pos[1]}`); process.exit(1); }
if (pos[2] && isNaN(CHAPTER_TO))   { console.error(`Invalid CHAPTER_TO: ${pos[2]}`);   process.exit(1); }
if (CHAPTER_FROM > CHAPTER_TO) {
  console.warn(`Warning: CHAPTER_FROM (${CHAPTER_FROM}) > CHAPTER_TO (${CHAPTER_TO}) — nothing to download`);
}
// -----------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const IMG_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
const PNG_IEND = Buffer.from("0000000049454e44ae426082", "hex");
const AVIF_BRANDS = new Set(["avif", "avis", "mif1", "msf1"]);

type Marker = { version: 1; count: number; urls: string[]; finishedAt: string };

class HttpError extends Error {
  constructor(public status: number, public retryAfter: string | null, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

// ---------- helpers ----------

function chapterNumber(ch: any): number | null {
  const m = /[?&]chapter=(\d+(?:\.\d+)?)/.exec(ch.url ?? "");
  if (m) return Number(m[1]);
  const t = /(\d+(?:\.\d+)?)\s*$/.exec(ch.title ?? "");
  return t ? Number(t[1]) : null;
}

/**
 * Pads only the integer part, keeping any fractional suffix intact.
 *   5     -> "ch_0005"
 *   12.5  -> "ch_0012.5"
 *   100   -> "ch_0100"
 */
function padChapterFolder(num: number): string {
  const [whole, frac] = String(num).split(".");
  return `ch_${whole.padStart(4, "0")}${frac ? "." + frac : ""}`;
}

/** Drops known decoy/ad URLs. Returns kept URLs and what was dropped (for logging). */
function cleanPages(raw: any[]): { urls: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const p of raw) {
    const u = typeof p === "string" ? p : p?.url;
    if (!u) continue;
    const full = u.startsWith("http") ? u : BASE + u;
    if (/\/img\/(free_ads|ads|banner|promo|sponsor)[._-]/i.test(full)) {
      dropped.push(full);
    } else {
      kept.push(full);
    }
  }
  return { urls: kept, dropped };
}

function extFor(url: string, contentType?: string | null): string {
  const m = /\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase();
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("avif")) return "avif";
  if (contentType?.includes("gif")) return "gif";
  return "jpg";
}

function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim();
}

function sameUrls(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (!isNaN(secs)) return secs * 1000;
  const d = Date.parse(v);
  return isNaN(d) ? null : Math.max(0, d - Date.now());
}

// ---------- image validation ----------

function detectKind(h: Buffer): "jpeg" | "png" | "gif" | "webp" | "avif" | null {
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "jpeg";
  if (h.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (h.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (h.subarray(0, 4).toString("latin1") === "RIFF" && h.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (h.subarray(4, 8).toString("latin1") === "ftyp" && AVIF_BRANDS.has(h.subarray(8, 12).toString("latin1"))) return "avif";
  return null;
}

async function validateImage(file: string): Promise<string | null> {
  let fh: FileHandle | undefined;
  try {
    const { size } = await fs.stat(file);
    if (size < MIN_FILE_SIZE) return `too small (${size} bytes)`;

    fh = await fs.open(file, "r");
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    const kind = detectKind(head);
    if (!kind) return "not a recognized image";

    const tailLen = Math.min(size, 32);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);

    if (kind === "jpeg" && tail.indexOf(Buffer.from([0xff, 0xd9])) === -1) return "truncated JPEG";
    if (kind === "png" && !tail.subarray(tailLen - 12).equals(PNG_IEND)) return "truncated PNG";
    if (kind === "gif" && tail[tailLen - 1] !== 0x3b) return "truncated GIF";
    if (kind === "webp" && head.readUInt32LE(4) + 8 > size) return "truncated WebP";
    return null;
  } catch (e: any) {
    return `read error: ${e.message}`;
  } finally {
    await fh?.close();
  }
}

// ---------- download ----------

async function downloadOnce(url: string, referer: string, chDir: string, idx: string): Promise<string> {
  const res = await fetch(encodeURI(url), {
    headers: {
      Referer: referer,
      "User-Agent": "Mozilla/5.0 (compatible; manhwaFetcher/1.0)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new HttpError(res.status, res.headers.get("retry-after"), url);
  if (!res.body) throw new Error(`No body for ${url}`);

  const finalPath = path.join(chDir, `${idx}.${extFor(url, res.headers.get("content-type"))}`);
  const partPath = `${finalPath}.part`;

  try {
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(partPath));

    const expected = Number(res.headers.get("content-length"));
    const { size } = await fs.stat(partPath);
    if (!res.headers.get("content-encoding") && expected && size !== expected) {
      throw new Error(`size ${size} != content-length ${expected}`);
    }

    const err = await validateImage(partPath);
    if (err) throw new Error(`invalid image (${err})`);

    await fs.rename(partPath, finalPath);

    for (const ext of IMG_EXTS) {
      const other = path.join(chDir, `${idx}.${ext}`);
      if (other !== finalPath) await fs.unlink(other).catch(() => {});
    }

    return finalPath;
  } catch (e) {
    await fs.unlink(partPath).catch(() => {});
    throw e;
  }
}

async function downloadWithRetry(url: string, referer: string, chDir: string, idx: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(url, referer, chDir, idx);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 0;
      if (attempt >= RETRIES || status === 404 || status === 410) throw e;

      let wait = 1000 * 3 ** attempt;
      if (status === 429) {
        wait = parseRetryAfter(e.retryAfter) ?? 30_000;
      }
      console.log(`    retry ${attempt + 1}/${RETRIES} in ${wait / 1000}s (${e.message})`);
      await sleep(wait);
    }
  }
}

// ---------- chapter state ----------

async function readMarker(chDir: string): Promise<Marker | null> {
  try {
    const m = JSON.parse(await fs.readFile(path.join(chDir, MARKER), "utf8"));
    return m?.version === 1 && Array.isArray(m.urls) ? m : null;
  } catch {
    return null;
  }
}

async function writeMarker(chDir: string, urls: string[]): Promise<void> {
  const marker: Marker = { version: 1, count: urls.length, urls, finishedAt: new Date().toISOString() };
  const tmp = path.join(chDir, `${MARKER}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(marker));
  await fs.rename(tmp, path.join(chDir, MARKER));
}

async function findExistingPage(chDir: string, idx: string): Promise<string | null> {
  for (const ext of IMG_EXTS) {
    const p = path.join(chDir, `${idx}.${ext}`);
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

async function countImageFiles(chDir: string): Promise<number> {
  try {
    const files = await fs.readdir(chDir);
    return files.filter(f => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

// ---------- main ----------

async function main() {
  const komikku = new Komikku();

  console.log(`Searching "${SERIES_NAME}" on ${PROVIDER}...`);
  const results = await komikku.search(SERIES_NAME, { providers: [PROVIDER], limitManga: 5 });
  if (!results.length) {
    console.error(`No results for "${SERIES_NAME}"`);
    console.error(`Tip: try the full title as shown on demonicscans.org (e.g. "Overgeared").`);
    process.exit(1);
  }

  const manga = results.find(m => m.title.toLowerCase() === SERIES_NAME.toLowerCase()) ?? results[0];
  console.log(`Selected: ${manga.title}`);

  const chapters = await manga.getChapters();
  const selected = chapters
    .map(ch => ({ ch, num: chapterNumber(ch) }))
    .filter(x => x.num !== null && x.num >= CHAPTER_FROM && x.num <= CHAPTER_TO)
    .sort((a, b) => a.num! - b.num!);

  console.log(
    `Total chapters: ${chapters.length}. In range: ${selected.length}` + (VERIFY ? " (verify mode)" : "")
  );

  const seriesDir = path.join(OUTPUT_DIR, safeName(manga.title));
  let failedChapters = 0;

  for (const { ch, num } of selected) {
    const chDir = path.join(seriesDir, padChapterFolder(num!));
    const refUrl = `${BASE}${ch.url}`;

    // Fast path: marked complete, no network at all.
    const marker = await readMarker(chDir);
    if (marker && !VERIFY) {
      console.log(`ch ${num}: complete (${marker.count}) - skip`);
      continue;
    }

    let urls: string[];
    try {
      const cleaned = cleanPages(await (ch as any).getPages());
      urls = cleaned.urls;
      if (cleaned.dropped.length) {
        console.log(
          `  ch ${num}: filtered ${cleaned.dropped.length} ad URL(s): ` +
          cleaned.dropped.map(u => path.basename(u)).join(", ")
        );
      }
    } catch (e) {
      console.error(`ch ${num}: getPages failed`, e);
      failedChapters++;
      continue;
    }
    if (!urls.length) {
      console.log(`ch ${num}: no pages after filtering - skip`);
      continue;
    }

    // --verify: deeply check the files on disk.
if (marker) {
  const urlsMatch = sameUrls(marker.urls, urls);
  
  if (!urlsMatch) {
    console.log(`ch ${num}: page list changed - wiping and re-downloading`);
    await fs.rm(chDir, { recursive: true, force: true });
  } else {
    // URLs match, now actually validate every file on disk.
    let corruptFound = false;
    for (let i = 0; i < urls.length; i++) {
      const idx = String(i + 1).padStart(3, "0");
      const existing = await findExistingPage(chDir, idx);
      if (!existing) {
        corruptFound = true;
        break;
      }
      const err = await validateImage(existing);
      if (err) {
        corruptFound = true;
        break;
      }
    }

    if (!corruptFound) {
      console.log(`ch ${num}: verified complete - skip`);
      continue;
    } else {
      console.log(`ch ${num}: found missing/corrupt pages - resuming`);
      // fall through to the download loop to fix them
    }
  }
}

    console.log(`\n=== Chapter ${num} (${urls.length} pages) ===`);
    await fs.mkdir(chDir, { recursive: true });

    // Clean up leftovers from a crash.
    for (const f of await fs.readdir(chDir)) {
      if (f.endsWith(".part") || f.endsWith(".tmp")) await fs.unlink(path.join(chDir, f)).catch(() => {});
    }

    let alreadyPresent = 0;
    let downloaded = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i++) {
      const idx = String(i + 1).padStart(3, "0");

      const existing = await findExistingPage(chDir, idx);
      if (existing) {
        const err = await validateImage(existing);
        if (!err) { alreadyPresent++; continue; }
        console.log(`  [${idx}] existing file bad (${err}) - redownloading`);
        await fs.unlink(existing).catch(() => {});
      }

      try {
        const saved = await downloadWithRetry(urls[i], refUrl, chDir, idx);
        downloaded++;
        console.log(`  [${idx}/${urls.length}] ${path.basename(saved)}`);
      } catch (e: any) {
        failed++;
        console.error(`  [${idx}] FAILED: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }

    console.log(`  summary: ${alreadyPresent} present, ${downloaded} downloaded, ${failed} failed`);

    if (failed === 0) {
      try {
        await writeMarker(chDir, urls);
      } catch (e: any) {
        console.error(`  Failed to write marker: ${e.message}`);
        failedChapters++;
      }
    } else {
      failedChapters++;
      console.error(`  ${failed} page(s) failed - no marker, next run will resume this chapter`);
    }
  }

  console.log(`\nDone. Files in: ${path.resolve(seriesDir)}`);
  if (failedChapters) {
    console.log(`${failedChapters} chapter(s) incomplete - re-run to resume.`);
    process.exit(2);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});