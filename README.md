# PocketPanel

Download manhwa chapters from [DemonicScans](https://demonicscans.org) for offline reading, plus a local web reader for your archived library.

Two parts:

- **`download.ts`**: scrapes a series and saves pages to disk.
- **`reader/`**: a local Express server and browser UI to read what you downloaded.

---

## Requirements

- Node.js 18+ (tested on 26)
- npm

## Install

```bash
npm install
```

This installs express, tsx, and the scraper dependency `@weismanns/komikku` (via JSR).

**Termux / Android users:** the project works on Termux. Express is pure JS, so no native compilation is needed.

---

## Searching for series

Before downloading, you can quickly check if a series exists on DemonicScans and see its status (ongoing, finished, hiatus).

```bash
npm run search -- "<Search Term>"
```

Example:

```bash
npm run search -- "Solo Leveling"
```

This prints up to 10 matches, showing the exact title, URL, and release status. If no results are found, it suggests trying a shorter or different keyword.

---

## Downloading series

The `download` npm script is a thin wrapper around `download.ts`.

### Basic usage

```bash
npm run download -- "<Series Name>"
```

The series name is required. Use the title exactly as it appears on demonicscans.org (you can use `npm run search` to find it).

### Full syntax

```bash
npm run download -- "<Series Name>" [from] [to] [outDir] [--verify]
```

| Argument | Required | Default | Meaning |
|---|---|---|---|
| `<Series Name>` | Yes | none | Title as shown on DemonicScans |
| `[from]` | No | `0` | First chapter number (inclusive) |
| `[to]` | No | all | Last chapter number (inclusive) |
| `[outDir]` | No | `./downloads` | Where to save files |
| `--verify` | No | off | Re-check completed chapters for re-uploads and corruption |

### Examples

```bash
# Download every chapter of Overgeared
npm run download -- "Overgeared"

# Chapters 100 through 110 only
npm run download -- "Overgeared" 100 110

# Custom output directory
npm run download -- "Solo Leveling" 0 5 ./my-manga

# Check completed chapters for re-uploads or missing/corrupt files
npm run download -- "Overgeared" --verify

# Download a single decimal chapter (e.g. 12.5)
npm run download -- "Overgeared" 12.5 12.5
```

### The `--` in `npm run download -- "name"`

The `--` is npm's argument separator. Everything after it is passed to the script verbatim. Without it, npm eats your arguments.

| Command | Result |
|---|---|
| `npm run download -- "Overgeared"` | ✅ passes "Overgeared" to the script |
| `npm run download "Overgeared"` | ❌ npm swallows the argument |
| `npm run download --"Overgeared"` | ❌ npm sees `--Overgeared` as a flag and errors |

Note the space after `--`.

### Output layout

```
downloads/
└── <Series Name>/
    ├── ch_0000/
    │   ├── 001.jpg
    │   ├── 002.jpg
    │   ├── 003.jpg
    │   └── .complete          # JSON marker written after all pages succeed
    ├── ch_0001/
    └── ...
```

Chapter folders are zero-padded (`ch_0001`) so they sort correctly. Fractional chapters (e.g. 12.5) are stored as `ch_0012.5`: only the integer part is zero-padded, so they sort correctly between `ch_0012` and `ch_0013`.

The `.complete` file looks like this:

```json
{ "version": 1, "count": 60, "urls": ["https://.../1.jpg"], "finishedAt": "2026-10-20T12:00:00.000Z" }
```

### Resuming

The script is safe to interrupt and re-run:

- Chapters with a `.complete` marker are skipped entirely, with no network calls.
- Chapters without a marker are resumed: existing pages are validated, bad ones are deleted, and missing ones are downloaded.
- Each page is written to `<name>.part`, then renamed only after passing integrity checks. A crash mid-download never leaves a truncated file at the final path.
- Failed pages are retried up to 3 times with 1s / 3s / 9s backoff. HTTP 404 and 410 abort immediately. HTTP 429 honors the `Retry-After` header, or waits 30s if there isn't one.
- A chapter only gets its marker if every page succeeded. If any page fails, re-run the same command to finish it.

Chapters downloaded by an older version of the script have no marker. They are validated once on the next run, then marked.

### What `--verify` does

By default, marked chapters are skipped at zero network cost. The tradeoff: if DemonicScans re-uploads a chapter and its pages change, or if a file gets corrupted or deleted locally, you won't know.

`--verify` re-fetches the page list for each marked chapter and compares it to the URL list stored in `.complete`:

- If the URLs match and all image files are present and pass integrity checks, the chapter is skipped.
- If the URLs match but some files are missing or corrupt, it resumes, fetching only the broken or missing pages.
- If the URLs differ (a re-upload), the chapter folder is wiped and re-downloaded from scratch.

Useful after long intervals, or if a chapter reads strangely (for example, images failing to load in the reader).

### Image integrity checks

Downloaded files are validated before being promoted from `.part` to their final name. Downloads are also compared against the `Content-Length` header when the response isn't compressed.

| Format | Checks |
|---|---|
| JPEG | Magic bytes + EOI marker (`FF D9`) within the last 32 bytes |
| PNG | Magic bytes + IEND chunk in the last 12 bytes |
| GIF | Magic bytes + trailer byte (`0x3B`) |
| WebP | Magic bytes + declared RIFF size not larger than the actual file |
| AVIF | `ftyp` box + known brand (`avif`, `avis`, `mif1`, `msf1`) |

Files that fail are deleted and re-downloaded. This catches truncated files, HTML error pages saved as images, and 0-byte stubs.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The run finished successfully; all selected chapters are complete |
| 1 | Fatal error (bad arguments, no search results, unhandled exception) |
| 2 | Some chapters are incomplete (pages failed to download); re-run to resume |

---

## Reading offline

Start the local reader:

```bash
npm run reader
```

Then open <http://localhost:4321>.

### Features

- **Library view**: grid of downloaded series with cover thumbnails
- **Chapter list**: per series, newest chapter first, with read indicators
- **Reader**: infinite vertical scroll (the right mode for manhwa), with keyboard navigation:
  - `←` / `→`: previous / next chapter
  - `Space` / `PageDown`: scroll down
  - `PageUp`: scroll up
  - `F`: toggle fit-width / original size
- **Progress saved**: `localStorage` remembers which chapters you've read (✓ in the chapter list)
- **Rescan button**: picks up newly downloaded chapters without restarting the server

### Accessing from another device

By default the server binds to all interfaces. If you're on the same WiFi, open:

```
http://<your-lan-ip>:4321
```

Find your LAN IP with `ip addr` (Linux/Termux) or `ifconfig` (macOS). On Termux, this lets you read on your phone or tablet from a laptop browser; fit-width mode is very comfortable.

To bind to a specific interface only, edit `reader/server.ts` and change:

```typescript
app.listen(PORT, () => ...)
```

to:

```typescript
app.listen(PORT, "127.0.0.1", () => ...)
```

### Adding new chapters while the reader runs

1. Run `npm run download -- "<Series>"` in another terminal.
2. Click **↻ Rescan** in the library header. No restart needed.

The reader ignores the `.complete` marker as long as it only picks up image files inside `ch_*` folders.

---

## Project layout

```
manhwaFetcher/
├── download.ts          # scraper
├── search.ts            # series lookup tool
├── package.json
├── README.md
├── downloads/           # your library (gitignored)
└── reader/
    ├── server.ts        # Express server
    └── public/
        ├── index.html   # library
        ├── series.html  # chapter list
        ├── reader.html  # page viewer
        ├── app.css
        ├── library.js
        ├── series.js
        └── reader.js
```

---

## Troubleshooting

### `EALLOWREMOTE` during `npm install`

Your npm security policy blocks JSR remote packages. Make sure `.npmrc` in the project root contains:

```ini
@jsr:registry=https://npm.jsr.io
allow-remote=all
```

Then re-run `npm install`.

### `tsx: not found` when running `npm run reader`

Install tsx as a dev dependency:

```bash
npm install --save-dev tsx
```

### `PathError: Missing parameter name at index 1: *`

Express 5 removed the bare `*` wildcard. The bundled `reader/server.ts` already uses `/*splat`. If you're upgrading an older version, change:

```typescript
app.get("*", ...)              // ❌ Express 4 only
app.get("/*splat", ...)        // ✅ Express 5
```

### `EUNKNOWNCONFIG: Unknown cli flag: --Overgeared`

You wrote `--"Name"` with no space. Use:

```bash
npm run download -- "Overgeared"
```

### `No results for "<Name>"`

The search on DemonicScans is fuzzy. Try:

- Using `npm run search -- "keyword"` to find the exact title.
- Part of the title (for example "Solo" instead of "Solo Leveling").
- Checking for apostrophes and accents; the site sometimes uses curly quotes.

If you still get nothing, the series may not exist on DemonicScans.

### AniList 429 messages during search

Cosmetic only. Those are metadata enrichment requests, not your download. Safe to ignore. Slow down re-runs if it gets noisy.

### An image is broken or blank in the reader

If a page shows a blank space or a browser broken-image icon, the file might have been corrupted during an earlier download.

1. Run the download command with `--verify` to force a deep check (for example, `npm run download -- "Series" 3 3 --verify`).
2. If that doesn't fix it, delete the specific broken file (`rm downloads/Series/ch_0003/003.jpg`) and re-run the download command.
3. Restart the reader server or click **↻ Rescan** to refresh the manifest.

---

## Notes

- **Legal:** this tool is for personal archival of content you can already access. Respect the site's terms of service, rate-limit yourself, and don't redistribute downloaded content.
- **Source quality:** DemonicScans serves compressed scans. Image resolution and clarity depend on their source. The script downloads exactly what the server returns, with no upscaling.
