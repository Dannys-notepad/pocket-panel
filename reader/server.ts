import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = path.resolve(__dirname, "..", "downloads");
const PORT = Number(process.env.PORT ?? 4321);

type PageRef = { file: string; url: string };
type ChapterRef = { id: string; name: string; number: number; pages: PageRef[]; thumb?: string };
type SeriesRef = { slug: string; name: string; chapters: ChapterRef[]; cover?: string };

let manifest: SeriesRef[] = [];

async function scanDownloads(): Promise<SeriesRef[]> {
  const series: SeriesRef[] = [];
  let seriesEntries: string[] = [];
  try {
    seriesEntries = (await fs.readdir(DOWNLOADS, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }

  for (const seriesName of seriesEntries) {
    const seriesPath = path.join(DOWNLOADS, seriesName);
    const chapterDirs = (await fs.readdir(seriesPath, { withFileTypes: true }))
      .filter(d => d.isDirectory() && /^ch_/.test(d.name))
      .map(d => d.name);

    const chapters: ChapterRef[] = [];
    for (const chDirName of chapterDirs) {
      const chPath = path.join(seriesPath, chDirName);
      const files = (await fs.readdir(chPath))
        .filter(f => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f))
        .sort();

      const pages: PageRef[] = files.map(f => ({
        file: f,
        url: `/files/${encodeURIComponent(seriesName)}/${encodeURIComponent(chDirName)}/${encodeURIComponent(f)}`,
      }));

      const numMatch = /^ch_(\d+(?:\.\d+)?)/.exec(chDirName);
      chapters.push({
        id: chDirName,
        name: chDirName.replace(/^ch_/, "Chapter "),
        number: numMatch ? Number(numMatch[1]) : chapters.length,
        pages,
        thumb: pages[0]?.url,
      });
    }

    chapters.sort((a, b) => a.number - b.number);

    series.push({
      slug: seriesName,
      name: seriesName,
      chapters,
      cover: chapters[0]?.thumb,
    });
  }

  return series;
}

const app = express();

app.get("/api/manifest.json", (_req, res) => res.json(manifest));

app.get("/api/refresh", async (_req, res) => {
  manifest = await scanDownloads();
  res.json({ ok: true, series: manifest.length });
});

// Serve chapter images
app.use("/files", express.static(DOWNLOADS, {
  maxAge: "7d",
  setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=604800"),
}));

// Serve the frontend
app.use(express.static(path.join(__dirname, "public")));

// SPA-ish fallback
app.get("/*splat", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

async function start() {
  manifest = await scanDownloads();
  console.log(`Scanned ${manifest.length} series, ${manifest.reduce((s, x) => s + x.chapters.length, 0)} chapters`);
  app.listen(PORT, () => console.log(`Reader running at http://localhost:${PORT}`));
}

start();