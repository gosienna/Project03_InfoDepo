# Testing

## Test Scripts

| Command | What it does |
|---------|-------------|
| `npm run test:epub` | Opens `test_epub.html` in a browser window — visual EPUB test |
| `npm run test:epub:headless` | Runs `test_epub.html` via Playwright (headless Chromium) — outputs console to terminal |
| `npm run test:drive` | Node.js script — validates `.env` credentials and lists files in test Drive folder |

---

## EPUB Viewer Test (`test_epub.html`)

Standalone browser page served by Vite at `http://localhost:3001/test_epub.html`.

Tests `test_documents/Project Hail Mary.epub` through the full EPUB.js pipeline.

### Tests run

| # | Test | What it checks |
|---|------|---------------|
| 1 | Fetch EPUB file | HTTP 200, reports file size |
| 2 | ArrayBuffer non-empty | Raw bytes received |
| 3 | `ePub()` constructor | EPUB.js can parse the file |
| 4 | Book metadata | Title, author, language readable |
| 5 | Spine has items | Book has chapters |
| 6 | `book.renderTo()` | EPUB.js renders to DOM |
| 7 | `rendition.display()` | First page displays |
| 8 | Navigate next/prev | Page navigation API works |
| 9 | Table of Contents | TOC entries available |

Results appear as ✅ / ❌ in the log bar. After tests complete, the book stays rendered for manual inspection.

### Important note on navigation tests

Tests 8 checks that `rendition.next()` / `rendition.prev()` **Promises resolve** — not that the visual page content changed. To verify actual navigation, check that the CFI changes:

```js
const cfiBefore = rendition.currentLocation().start.cfi;
await rendition.next();
const cfiAfter = rendition.currentLocation().start.cfi;
// cfiBefore !== cfiAfter → page actually changed
```

---

## Headless EPUB Test (`test-epub-browser.js`)

Uses Playwright to run `test_epub.html` in headless Chromium and pipe all browser console output back to the terminal.

```
npm run test:epub:headless
→ [browser] ✅  Fetch EPUB file  —  688.0 KB
→ [browser] ✅  Book metadata loaded  —  title: "..."
→ ...
→ ✅  All 10 tests passed.
```

Exits with code `0` on all pass, `1` if any fail — suitable for CI.

**Requires** the Vite dev server to be running:
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run test:epub:headless
```

---

## Drive Connection Test (`test-drive-connection.js`)

Node.js script — no browser needed.

**What it does:**
1. Loads `.env` from project root
2. Validates credential format:
   - API Key must start with `AIza...`
   - Client ID must have numeric prefix + `.apps.googleusercontent.com`
   - Detects common mistake of putting Client Secret (`GOCSPX-...`) in API Key field
3. Calls Drive API v3 to list files in `VITE_TEST_DRIVE_FOLDER_ID`
4. Prints file names, types, and sizes

**Requirements:**
- `VITE_TEST_API_KEY` must be a valid API Key (not Client Secret)
- `VITE_TEST_DRIVE_FOLDER_ID` folder must be shared as "Anyone with the link can view"
- Google Drive API must be enabled in the same Google Cloud project as the API Key

**Example output:**
```
✅  Connected. Found 3 file(s) in test folder:

  Name                                         Type    Size
  ──────────────────────────────────────────────────────────────
  Project Hail Mary.epub                       EPUB    688.0 KB
  sample.pdf                                   PDF     1.2 MB
  notes.txt                                    TXT     4.1 KB
```

---

## Test Data

| File | Location | Used by |
|------|----------|---------|
| Project Hail Mary.epub | `test_documents/` | `test_epub.html`, `test-epub-browser.js` |
| Google Drive folder | `VITE_TEST_DRIVE_FOLDER_ID` in `.env` | `test-drive-connection.js`, `DevDriveBrowser` |
