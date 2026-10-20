# Improvement Plan: CBZ Archives + Reader Support

## Goal
Let completed chapters be archived as CBZ files (space-efficient, one file per
chapter), while keeping downloads resumable and repairable. The reader should
transparently serve both folder-based and CBZ-based chapters.

## Design decisions

### 1. Keep downloads as-is (folders + `.complete` markers)
The current resume/integrity system is the reason interrupted downloads are safe.
Packing to CBZ *during* download breaks that:
- A crashed zip write loses the whole chapter (no page files left)
- Corrupt pages inside a zip can't be repaired individually
- The atomic `.part` → rename pattern doesn't apply to zip creation

**Therefore: downloads stay as folders. Packing is a separate step.**

### 2. Add `npm run pack` as a standalone command
Walks `downloads/<series>/`, packs each chapter folder that has a `.complete`
marker into `archives/<series>/ch_XXXX.cbz`.

- **Atomic:** writes to `ch_XXXX.cbz.part`, renames on success
- **Resumable:** skips chapters whose `.cbz` already exists and matches the
  marker's page count
- **Safe deletion:** optionally deletes the source folder only after verifying
  the CBZ is readable (list entries, count matches marker count)
- **Dry-run mode:** `--dry-run` reports what would be packed without touching disk

### 3. Reader serves both folders and CBZs
`reader/server.ts` scans both `downloads/` and `archives/`. The manifest doesn't
distinguish — chapters just have `pages[].url`. The frontend is unchanged.

- Folder chapter: `/files/<series>/ch_XXXX/001.webp`
- CBZ chapter:   `/files/<series>/ch_XXXX.cbz/001.webp`

A new Express route reads individual entries from a CBZ using `yauzl` (streams
the requested entry from disk, doesn't load the whole zip).

### 4. Precedence when both exist
If a chapter exists as both a folder and a CBZ (e.g., you packed but haven't
deleted the folder yet), the **CBZ wins** in the manifest. This makes
"pack then delete" a safe two-step with no window where the chapter disappears.

## Non-goals
- Auto-packing during download (breaks resume — see decision 1)
- Re-encoding images (your WebPs are already compressed; gains are marginal)
- Converting CBZ back to folders automatically (unzip is a one-liner if needed)

## Implementation checklist

### Pack command (`pack.ts`)
- [ ] Argument parsing: series name, `--dry-run`, `--delete-after-pack`
- [ ] Walk `downloads/<series>/ch_*/` directories
- [ ] For each with `.complete`:
  - [ ] Read marker to get expected page count
  - [ ] If `archives/<series>/ch_XXXX.cbz` exists, skip (or `--verify` to re-check)
  - [ ] Write zip to `ch_XXXX.cbz.part` (flatten paths, exclude `.complete`)
  - [ ] Verify: reopen zip, count image entries, confirm == marker count
  - [ ] Rename to `ch_XXXX.cbz`
  - [ ] If `--delete-after-pack`: `rm -rf` the source folder
- [ ] Print summary: packed N chapters, skipped M, deleted K

### Reader server (`reader/server.ts`)
- [ ] Scan `archives/<series>/*.cbz` in addition to `downloads/<series>/ch_*/`
- [ ] If both a folder and CBZ exist for the same chapter number, prefer CBZ
- [ ] New route: `GET /files/:series/:cbz/:entry` reads from zip (using `yauzl`)
- [ ] Cache the zip reader per CBZ file (small LRU, e.g. last 2 chapters) to avoid
      re-opening the zip per image request
- [ ] Cache-Control headers same as folder route

### Dependencies
- `yauzl` (or `adm-zip` if you accept the memory cost per request)
- `archiver` (for writing zips in `pack.ts`)

### README updates
- [ ] Document `npm run pack` with examples
- [ ] Document folder vs CBZ precedence
- [ ] Note: reader URL for CBZ chapters includes the `.cbz` segment
- [ ] Space math: one 80-page chapter as folder ≈ X MB in files but Y MB on disk
      due to block overhead; as CBZ ≈ Y MB with no overhead

## Order of work
1. `pack.ts` + `npm run pack` (test on one series, verify CBZs open in an external reader)
2. Reader CBZ support (test: reader shows packed chapters, pages load)
3. Precedence logic (test: pack without deleting → still readable)
4. `--delete-after-pack` (test: pack + delete → chapter still readable from CBZ only)
5. README updates

## Open questions
- Should `pack.ts` also support packing a whole series into one CBZ (for archival)?
  Probably no — per-chapter is better for partial reads.
- Should the reader fall back to a CBZ if the folder is missing? Yes, naturally,
  since the scan finds both.
- Should `--delete-after-pack` be the default? **No.** Default to keeping folders
  after packing, let the user verify, then delete manually or via a separate
  `npm run cleanup` command.