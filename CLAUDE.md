# CLAUDE.md — InfoDepo

## Project Overview

A client-side media library and reader. Content (books, notes, YouTube links, channels) is imported from local files or Google Drive, stored as blobs in IndexedDB (`InfoDepo` database, schema version 6). Owners can share subsets of their library with other Google accounts via Drive-backed share configs. No backend; everything runs in the browser.

> For detailed documentation see [`documents/`](documents/):
> - [Architecture](documents/architecture.md)
> - [Components & App Startup](documents/components.md)
> - [EPUB Reader](documents/epub-reader.md)
> - [Google Drive Integration](documents/google-drive-integration.md)
> - [Testing](documents/testing.md)
> - [Dev Setup](documents/dev-setup.md)
> - [Data Stores](documents/data-stores.md)
> - [Drive synchronization](documents/drive-synchronization.md)

## Tech Stack

- **React 18.3.1** — functional components, hooks only, no JSX (uses `React.createElement()` throughout)
- **Vite 6.2.0** — dev server on port 3001
- **Tailwind CSS** — loaded via CDN in `index.html`
- **IndexedDB** (`InfoDepo`, version 6) — seven stores: `books`, `notes`, `videos`, `images`, `channels`, `shares`, `pdfAnnotations`
- **YouTube Data API v3** — channel video listing (reuses `VITE_API_KEY`)
- **Google OAuth 2.0 + Drive API v3** — folder sync/backup, share permissions, OAuth gate
- **EPUB.js** — EPUB rendering (CDN)
- **Playwright** — headless browser testing

## Running Locally

```bash
npm install
npm run dev
# → http://localhost:3001
```

When `VITE_CLIENT_ID` + `VITE_API_KEY` are set, the app shows a `GoogleOAuthGate` on first run to collect the Drive folder ID and sign in. Without those env vars, the app opens directly to the library (local-only mode).

## Deployment (Netlify)

Published to Netlify as a static site.

```bash
npm run build   # outputs to dist/
```

Netlify build settings:
- **Build command:** `npm run build`
- **Publish directory:** `dist`

No backend or serverless functions.

## Architecture

```
App.js                            # View switching (library ↔ reader ↔ channel), IndexedDB init, OAuth gate
├── GoogleOAuthGate.js            # First-run: Drive folder ID + Google sign-in
├── Header.js                     # Nav bar, back button, user email
├── Library.js                    # Item/channel/share grid, search/filters, Drive sync/backup, share filter
│   ├── DataTile.js               # Grid tiles for items, channels, and shares (same shell)
│   ├── SharesEditorModal.js      # Owner share editor / receiver read-only view
│   ├── DevDriveBrowser.js        # OAuth + Drive API v3 folder browser
│   ├── NewNoteModal.js           # Create a new Markdown note
│   ├── NewChannelModal.js        # YouTube channel URL input + API fetch
│   └── NewYoutubeModal.js        # Single YouTube video URL input
├── YoutubeChannelViewer.js       # Sortable video grid for a channel (reuses DataTile); auto-refreshes for new videos on mount
└── Reader.js                     # Dispatches to viewer by file extension / MIME type
    ├── PdfViewer.js
    ├── TxtViewer.js
    ├── MarkdownEditor.js         # Markdown editor with HTML/Markdown dual modes, slash commands, go-to-section, image assets
    ├── YoutubeViewer.js          # YouTube embed via youtube-nocookie.com iframe
    └── UnsupportedViewer.js

hooks/useIndexedDB.js             # All IndexedDB CRUD (six stores), merged items, shares, channels
utils/driveCredentials.js         # Credential source: .env vars (VITE_CLIENT_ID, VITE_API_KEY)
utils/driveSync.js                # Drive sync engine — backup, folder sync, shared content download
utils/libraryDriveSync.js         # Owner backup+pull pipeline; receiver share download wrapper for Library
utils/driveSharePermissions.js    # Reconcile Drive ACLs from owner share records
utils/sharesDriveJson.js          # Share config serialization/deserialization for Drive JSON
utils/sharesDriveFile.js          # Upload/fetch share JSON files to/from Google Drive
utils/youtubeApi.js               # resolveChannelId() + fetchChannelVideos() + fetchNewChannelVideos() via YouTube Data API v3
reader.html                       # Standalone EPUB reader (opens in new tab, no iframe sandbox issues)
```

See [documents/architecture.md](documents/architecture.md) for full data flow.

## Importing Content

**Local file:** "Add" menu → file picker (EPUB, PDF, TXT, Markdown). Always available, no credentials needed.

**Markdown note:** "Add" menu → `NewNoteModal`. Creates a `.md` blob in the `notes` store, editable in `MarkdownEditor`.

**YouTube video:** "Add" menu → `NewYoutubeModal`. Saves a JSON blob `{ url, title }` to the `videos` store.

**YouTube channel:** "Add" menu → `NewChannelModal`. Enter a channel URL (e.g. `youtube.com/@stanfordonline`), fetches all non-Shorts videos via YouTube Data API v3, stores in `channels` IndexedDB store.

**Google Drive folder:** `DevDriveBrowser` — OAuth + Drive API v3 folder browser. Credentials from `.env`.

See [documents/google-drive-integration.md](documents/google-drive-integration.md).

## Shares

Owners create **shares** to grant Google accounts read access to subsets of their library:

1. **New share** → `SharesEditorModal`: set filename, recipient emails, include-by-tag, and/or pick explicit items with `driveId`.
2. **Save & upload** serializes the share config to a `*.infodepo-shares.json` file on Drive and applies reader ACLs to referenced files via Drive Permissions API.
3. Tag changes and new uploads automatically re-resolve `includeTags` → `explicitRefs` and re-apply ACLs (debounced).

Receivers **link** a share by pasting the Drive JSON file ID or URL. The app fetches the share config, downloads referenced content via `syncSharedFilesByDriveId`, and stores it in IndexedDB. Clicking a receiver share tile activates a **content filter** — the library grid narrows to only items whose `driveId` matches the share's `explicitRefs`.

## Library Modes

- **Owner** — full access: import, edit, upload to Drive, backup/sync, create shares
- **Shared** — read-only sync from a shared Drive folder; no upload, delete, or tag editing

Mode is persisted via `utils/libraryMode.js`. Switching modes may re-trigger the OAuth gate if no valid token exists for the other scope.

## .env (gitignored)

```
VITE_CLIENT_ID=         # OAuth 2.0 Client ID
VITE_API_KEY=           # Google API Key (...) — also used for YouTube Data API v3
```

The Drive **folder ID** is collected at runtime via `GoogleOAuthGate` and stored in `localStorage`.

## Key Conventions

- **No JSX** — all components use `React.createElement()`, not JSX syntax
- **CDN-loaded libraries** — EPUB.js, Google APIs, Tailwind, React loaded via CDN in `index.html`
- **EPUB opens in new tab** — `reader.html?id=X` avoids iframe sandbox restrictions
- **IndexedDB schema v6** — seven stores; `pdfAnnotations` for PDF markup sidecars; `shares` added in v2 with migration from `localStorage`
- **Google Drive scopes** — `drive.file` for owner operations; broader scope if share ACLs require it

## Testing

```bash
npm run test:epub              # Open EPUB test in browser
npm run test:epub:headless     # Headless via Playwright (requires npm run dev)
npm run test:drive             # Validate .env credentials + list Drive folder
```

See [documents/testing.md](documents/testing.md) for full details.
