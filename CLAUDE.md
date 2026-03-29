# CLAUDE.md — Zenith E-Book Reader

## Project Overview

A client-side web app for reading e-books offline. Books are imported from local files or (in dev mode) from a Google Drive folder, then stored as blobs in IndexedDB. No backend; everything runs in the browser.

## Tech Stack

- **React 18.3.1** — functional components, hooks only, no JSX (uses `React.createElement()` throughout)
- **Vite 6.2.0** — dev server on port 3000 (may increment if port is busy)
- **Tailwind CSS** — loaded via CDN in `index.html`
- **IndexedDB** — local book storage (blobs + metadata)
- **Google OAuth 2.0 + Drive API v3** — dev-only, for loading test books from Drive folder
- **EPUB.js** — EPUB rendering (CDN)

## Running Locally

```bash
npm install
npm run dev
# → http://localhost:3000 (or 3001+ if port taken)
```

No setup screen. App opens directly to the library.

Fill in `.env` before using the dev Drive browser (see Dev Mode below).

## Architecture

```
App.js                    # View switching (library ↔ reader), IndexedDB init
├── Header.js             # Nav bar, back button
├── Library.js            # Book grid, local file upload, dev Drive browser trigger
│   ├── BookCard.js       # Individual book item + delete
│   └── DevDriveBrowser.js  # Dev-only: OAuth + Drive API v3 folder browser
└── Reader.js             # Dispatches to viewer by file extension
    ├── EpubViewer.js
    ├── PdfViewer.js
    └── TxtViewer.js
```

**hooks/useIndexedDB.js** — all IndexedDB operations (open, add, delete, list). Books sorted newest-first by `added` timestamp. Schema: `{id, name, type, data (Blob), size, added}`.

**utils/fileUtils.js** — file extension extraction, byte size formatting.

## Importing Books

**Production:** "Add Book" button → local file picker (EPUB, PDF, TXT). No credentials needed.

**Dev mode:** Yellow **"DEV: Test Folder"** button → `DevDriveBrowser` modal. OAuth via Google Identity Services, lists files from `VITE_TEST_DRIVE_FOLDER_ID`, downloads via Drive API v3. Credentials read from `.env` — never from `localStorage`.

## .env (dev only, gitignored)

```
VITE_TEST_DRIVE_FOLDER_ID=   # Google Drive folder ID for test books
VITE_TEST_CLIENT_ID=         # OAuth 2.0 Client ID
VITE_TEST_API_KEY=            # Google API Key (Drive API enabled)
```

The "DEV: Test Folder" button only renders when `import.meta.env.DEV` is true — stripped in production builds.

## Key Conventions

- **No JSX** — all components use `React.createElement()`, not JSX syntax
- **No setup screen** — app opens directly to library; no credentials stored in `localStorage`
- **CDN-loaded libraries** — EPUB.js, Google APIs, Tailwind, React loaded via CDN in `index.html`, not bundled by Vite
- **Google Drive scope** — `drive.readonly` only
- **Dev-only code** — guard with `import.meta.env.DEV`; Vite tree-shakes it from production

## Google Cloud Setup (for dev Drive access)

1. Enable **Google Drive API** in Google Cloud Console (Picker API not needed)
2. Create **OAuth 2.0 Client ID** (Web app) — add `http://localhost:3001` to authorized origins (test script port)
3. Create an **API Key** — restrict to Drive API
4. Fill both into `.env` as `VITE_TEST_CLIENT_ID` and `VITE_TEST_API_KEY`

## Testing

```bash
npm run test:epub
# → opens http://localhost:3001/test_epub.html
```

Port 3001 is used because the dev server holds 3000. Run `npm run dev` first, then `npm run test:epub` in a second terminal.

`test_epub.html` — browser-based test page, runs 9 checks against `test_documents/Project Hail Mary.epub` and renders the book for manual inspection.
