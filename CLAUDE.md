# CLAUDE.md — InfoDepo

## Project Overview

A client-side e-book reader. Books are imported from local files or (in dev mode) from a Google Drive folder, then stored as blobs in IndexedDB (`InfoDepo` database). No backend; everything runs in the browser.

> For detailed documentation see [`documents/`](documents/):
> - [Architecture](documents/architecture.md)
> - [Components & App Startup](documents/components.md)
> - [EPUB Reader](documents/epub-reader.md)
> - [Google Drive Integration](documents/google-drive-integration.md)
> - [Testing](documents/testing.md)
> - [Dev Setup](documents/dev-setup.md)

## Tech Stack

- **React 18.3.1** — functional components, hooks only, no JSX (uses `React.createElement()` throughout)
- **Vite 6.2.0** — dev server on port 3001
- **Tailwind CSS** — loaded via CDN in `index.html`
- **IndexedDB** (`InfoDepo`) — local book storage (blobs + metadata)
- **Google OAuth 2.0 + Drive API v3** — dev-only, for loading test books from Drive folder
- **EPUB.js** — EPUB rendering (CDN)
- **Playwright** — headless browser testing

## Running Locally

```bash
npm install
npm run dev
# → http://localhost:3001
```

No setup screen. App opens directly to the library. Fill in `.env` before using the dev Drive browser.

## Architecture

```
App.js                    # View switching (library ↔ reader), IndexedDB init
├── Header.js             # Nav bar, back button
├── Library.js            # Book grid, local file upload, dev Drive browser trigger
│   ├── BookCard.js       # Individual book item + delete
│   └── DevDriveBrowser.js  # Dev-only: OAuth + Drive API v3 folder browser
└── Reader.js             # Dispatches to viewer by file extension / MIME type
    ├── PdfViewer.js
    └── TxtViewer.js

reader.html               # Standalone EPUB reader (opens in new tab, no iframe sandbox issues)
```

See [documents/architecture.md](documents/architecture.md) for full data flow.

## Importing Books

**Production:** "Add Book" → local file picker (EPUB, PDF, TXT). No credentials needed.

**Dev mode:** Yellow **"DEV: Test Folder"** button → `DevDriveBrowser`. Credentials from `.env` only.

See [documents/google-drive-integration.md](documents/google-drive-integration.md).

## .env (dev only, gitignored)

```
VITE_TEST_DRIVE_FOLDER_ID=   # Google Drive folder ID
VITE_TEST_CLIENT_ID=         # OAuth 2.0 Client ID
VITE_TEST_API_KEY=            # Google API Key (AIza...)
```

## Key Conventions

- **No JSX** — all components use `React.createElement()`, not JSX syntax
- **No setup screen** — app opens directly to library; no credentials in `localStorage`
- **CDN-loaded libraries** — EPUB.js, Google APIs, Tailwind, React loaded via CDN in `index.html`
- **EPUB opens in new tab** — `reader.html?id=X` avoids iframe sandbox restrictions
- **Dev-only code** — guard with `import.meta.env.DEV`; Vite tree-shakes it from production
- **Google Drive scope** — `drive.readonly` only

## Testing

```bash
npm run test:epub              # Open EPUB test in browser
npm run test:epub:headless     # Headless via Playwright (requires npm run dev)
npm run test:drive             # Validate .env credentials + list Drive folder
```

See [documents/testing.md](documents/testing.md) for full details.
