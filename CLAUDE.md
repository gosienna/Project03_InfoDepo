# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A client-side media library and reader. Content (books, notes, YouTube links, URL bookmarks, images, channels, desks) is imported from local files or Google Drive and stored as blobs in IndexedDB (`InfoDepo` database, schema version 11). Records use a stable local `driveId` (`local:{store}:{uuid}`) plus optional `driveFileId` for Google Drive — see [`documents/data-stores.md`](documents/data-stores.md). There is no backend; everything runs in the browser and syncs directly to Google Drive over OAuth.

> For deeper detail see [`documents/`](documents/) — keep these in sync when you change the corresponding behavior:
> - [Architecture](documents/architecture.md)
> - [Components & App Startup](documents/components.md)
> - [EPUB Reader](documents/epub-reader.md)
> - [Google Drive Integration](documents/google-drive-integration.md)
> - [Sharing Mechanism](documents/sharing-mechanism.md)
> - [Drive Synchronization](documents/drive-synchronization.md)
> - [Data Stores](documents/data-stores.md)
> - [Theming](documents/theming.md)
> - [Dev Setup](documents/dev-setup.md)
> - [Testing](documents/testing.md)

## Tech Stack

- **React 18.3.1** — functional components, hooks only, **no JSX** (`React.createElement()` throughout)
- **Vite 6.2.0** — dev server on port 3001; three build entry points (`index.html`, `reader.html`, `pdf-reader.html`)
- **Tailwind CSS**, **EPUB.js/foliate-js**, **KaTeX 0.16.11** — all CDN-loaded, not bundled
- **IndexedDB** (`InfoDepo`, v11) — stores: `books` (also holds standalone images), `notes`, `videos` (YouTube links + URL bookmarks), `images` (legacy), `channels`, `desks`, `pdfAnnotations`
- **Google OAuth 2.0 + Drive API v3** — backup/sync, item-level share ACLs, `config.json`-based role/config storage
- **YouTube Data API v3** — channel video listing (reuses `VITE_API_KEY`)
- **Playwright** — headless browser testing

## Running Locally

```bash
npm install
npm run dev        # → http://localhost:3001
npm run build       # production build (dist/), 3 entry points
```

Role and Google Drive access are controlled by env vars (`.env`, gitignored):

```
VITE_CLIENT_ID=   # OAuth 2.0 Client ID
VITE_API_KEY=     # Google API Key — Drive + YouTube Data API v3
VITE_MASTER=      # email always resolved to role 'master'
VITE_CONFIG=      # Drive file ID of config.json (users map: email -> {role, folderId})
```

Without `VITE_CLIENT_ID`/`VITE_API_KEY` the app runs local-only (no gates, no role resolution). Netlify publish dir is `dist`, build command `npm run build`, no serverless functions.

## Architecture

### Startup sequence (see [documents/components.md](documents/components.md))

1. `index.js` mounts `App`; `useIndexedDB()` opens `InfoDepo` and loads merged items/channels/desks.
2. If Google credentials exist and no valid token is cached, `GoogleLoginGate` blocks until sign-in.
3. Role resolves to `master` / `editor` / `viewer` / `unauthorized` from `VITE_MASTER` + `config.json`'s `users` map (`utils/userConfig.js`).
4. `DriveFolderGate` runs only for `master`/`editor` (folder ID setup); `viewer` skips it and instead reads peer folder IDs from `config.json`.
5. `Header` + `Library` (or `Desk`/`Reader`/`Explorer`/`YoutubeChannelViewer`) render.

**Note:** `components/GoogleOAuthGate.js` is legacy/unused — the live gate flow is `GoogleLoginGate` → `DriveFolderGate`. A few other components are similarly dead (`BookCard.js`, `TagShareModal.js`); grep for imports before assuming a component is on the live path.

### View router (`App.js`)

`App.js` is the central hub: it owns role resolution, wires every `useIndexedDB` helper into `Library`/`Desk`/`Reader`, and switches between `library` / `desk` / `reader` / `channel` view modes. It also owns the add-content modals (`NewNoteModal`, `NewYoutubeModal`, `NewChannelModal`, `NewUrlModal`) so both `Library` and `Desk` can trigger them, and `openItem()` — the unified click handler that downloads a blob (with progress) before opening it inline or in a new reader tab.

### Readers: inline vs. new-tab

- `Reader.js` dispatches inline (same-tab) viewers by extension/MIME: PDF → `PdfViewer`, TXT → `TxtViewer`, Markdown → `MarkdownEditor`, YouTube → `YoutubeViewer`.
- **EPUB/MOBI/AZW/AZW3** and **PDF** instead open in their own tab via `window.open('/reader.html?...')` / `window.open('/pdf-reader.html?...')`, each with a matching standalone entry point (`reader-entry.js` + `FoliateViewer.js`, `pdf-reader-entry.js` + `PdfViewer.js`). This avoids `WebKitBlobResource error 1` on iOS/iPadOS. Both entry points open IndexedDB directly (`?id=X&store=Y` / `?driveId=X&store=Y`), lazily download the blob from Drive via a token cached in `localStorage` if `data` is null, and save reading position back to IndexedDB independent of the main app's state.
- `vite.config.js` patches `foliate-js` at build time (two custom transform plugins) to fix iOS Safari blob-loading bugs — read the comments there before touching EPUB rendering or upgrading `foliate-js`.

### Theming

Tailwind is CDN-loaded with no build-time config, so the user-selectable accent theme (System Settings) works via CSS custom properties, not static classes: `index.html`, `reader.html`, and `pdf-reader.html` each declare `--theme-{shade}` variables and map Tailwind's `theme` color family to `rgb(var(--theme-XXX) / <alpha-value>)`. `utils/theme.js` overwrites those variables from `localStorage` at module load (imported for its side effect by all three entry points), so ordinary classes like `bg-theme-600/50` just work and no component ever branches on the active theme. See [documents/theming.md](documents/theming.md) before adding a new theme or a fourth HTML entry point.

### Roles and sharing

Sharing is **item-level**, not link-based: every content record carries `sharedWith: string[]` and `ownerEmail`. There is no `shares` IndexedDB store (removed in schema v7).

- `master`/`editor` can edit `sharedWith` on records they own; edits trigger a debounced Drive ACL reconcile (`utils/driveSharePermissions.js`) and a rewrite of the owner's `_infodepo_index.json` discovery file.
- `viewer` is read-only; it discovers shared content by reading peer folder IDs from `config.json`, fetching each peer's `_infodepo_index.json`, downloading rows where it appears in `sharedWith`, and pruning rows that are no longer shared.
- Adding an item/channel/nested-desk to a desk that already has `sharedWith` recipients auto-propagates those recipients to the new record.

Full detail: [documents/sharing-mechanism.md](documents/sharing-mechanism.md).

### Importing content

Local file import (EPUB/PDF/TXT/Markdown/image) needs no credentials. `NewNoteModal`/`NewYoutubeModal`/`NewChannelModal`/`NewUrlModal` create typed records directly in IndexedDB. `Explorer.js` converts a web page to a Markdown note via a Rust→WASM extractor (`wasm-trafilatura`) — see [Web Extractor setup](documents/dev-setup.md#web-extractor-wasm-setup) if you touch that path; missing `public/wasm/*` files cause a 404 at runtime, not a build error.

## Key Conventions

- **No JSX anywhere** — `React.createElement()` only.
- **`driveId` is the permanent key**; `driveFileId` is Drive-only and mutated in place on upload/sync — never re-key a record when it gets a Drive copy.
- **Role gates live in `App.js`/`Library.js`**, not scattered per-component; check `userType` before adding new role-conditional UI.
- Both `reader.html` and `pdf-reader.html` must stay registered in `vite.config.js`'s `build.rollupOptions.input` — a new standalone reader tab needs an entry there too.

## Testing

```bash
npm run test:epub              # Open EPUB test page in browser (visual)
npm run test:epub:headless     # Headless via Playwright (requires `npm run dev` running)
npm run test:epub:prod         # Same suite against a deployed URL (default: GitHub Pages)
npm run test:txt               # Open TXT viewer test page in browser
npm run test:txt:headless      # Headless TXT test via Playwright
```

See [documents/testing.md](documents/testing.md). Note: that doc and [documents/dev-setup.md](documents/dev-setup.md) still reference an `npm run test:drive` script and `VITE_TEST_*` env vars that no longer exist in this repo — disregard those sections.
