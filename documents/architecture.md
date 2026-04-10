# Architecture

## Overview

InfoDepo is a fully client-side media library. No backend server. All data lives in the browser.

```
User
 └── Browser
      ├── React App (Vite, port 3001)
      │    ├── Library view      — item grid, file import, YouTube links
      │    └── Reader view       — PDF / TXT / Markdown / YouTube inline viewers
      ├── reader.html            — standalone EPUB reader (new tab)
      └── IndexedDB              — local item storage (shared by both pages)
```

## Component Tree

```
App.js
├── Header.js               # Nav bar, back button
├── Library.js              # Item grid, file upload, YouTube modal, Drive browser, share filter
│   ├── DataTile.js         # Library grid tiles (items + channels + shares; same column layout)
│   ├── SharesEditorModal.js # Owner share editor / receiver read-only view
│   ├── NewNoteModal.js     # Create a new Markdown note
│   ├── NewYoutubeModal.js  # Add a YouTube video or channel link
│   └── DevDriveBrowser.js  # Dev/prod: OAuth + Drive API folder browser
├── YoutubeChannelViewer.js # Sortable video grid for a channel; auto-refreshes new videos on mount
└── Reader.js               # Dispatches to viewer by file extension / MIME type
    ├── PdfViewer.js        # PDF via pdf.js + SVG overlays; annotations saved with pdf-lib
    ├── TxtViewer.js        # Plain text via FileReader
    ├── MarkdownEditor.js   # Markdown editor with live preview and image assets
    ├── YoutubeViewer.js    # YouTube embed via youtube-nocookie.com iframe
    └── UnsupportedViewer.js
```

## Data Flow

```
Import (local file)
  input[type=file] → File (Blob) → useIndexedDB.addItem() → IndexedDB 'books' store

Import (YouTube URL)
  NewYoutubeModal → JSON Blob (url + title) → useIndexedDB.addItem() → IndexedDB 'videos' store

Import (dev/prod Drive)
  DevDriveBrowser → OAuth → Drive API v3 → Blob → useIndexedDB.upsertDriveBook() → IndexedDB 'books' store

Open item
  DataTile click → App.handleSelectVideo(video)
    ├── EPUB    → window.open('/reader.html?id=X')
    │             └── reader.html reads IndexedDB 'books' store by ID → EPUB.js
    ├── PDF/TXT → Reader.js → inline viewer component
    ├── MD      → Reader.js → MarkdownEditor
    └── YouTube → Reader.js → YoutubeViewer (iframe embed)

Share (owner)
  New share → SharesEditorModal → addShare() → IndexedDB 'shares' store
  Save & upload → serializeShareToDriveJson → Drive file + applyShareRecordsToDriveFiles (ACLs)

Share (receiver)
  Link share → paste Drive file ID/URL → fetchSharesJsonByFileId → addShare() → IndexedDB 'shares'
  Click share tile → activeShareFilter → library grid filtered to explicitRefs driveIds
                   → syncSharedFilesByDriveId downloads referenced files into IndexedDB
```

## Key Files

| File | Role |
|------|------|
| `App.js` | Root — view state, item selection routing |
| `hooks/useIndexedDB.js` | All IndexedDB CRUD. Six stores: `books`, `notes`, `videos`, `images`, `channels`, `shares`. See [data-stores.md](data-stores.md) |
| `components/DataTile.js` | Grid cards for items, channels, and shares — same shell; YouTube thumb or BookIcon; tags |
| `components/YoutubeViewer.js` | Embeds YouTube video via `youtube-nocookie.com/embed/{id}` iframe |
| `components/NewYoutubeModal.js` | Modal to save a YouTube URL as a `application/x-youtube` JSON blob |
| `reader.html` | Standalone EPUB reader page, no React |
| `utils/fileUtils.js` | File extension extraction, byte size formatting |
| `utils/driveSync.js` | Drive sync engine — owner backup (POST/PATCH), folder pull, shared content download |
| `utils/sharesDriveJson.js` | Share config serialization/deserialization for Drive JSON |
| `utils/sharesDriveFile.js` | Upload/fetch share JSON files to/from Google Drive |
| `utils/driveSharePermissions.js` | Reconcile Drive ACLs from owner share records |
| `utils/youtubeApi.js` | `resolveChannelId()`, `fetchChannelVideos()`, `fetchNewChannelVideos()` via YouTube Data API v3 |

## Supported Content Types

| Extension | MIME type | Viewer | Notes |
|-----------|-----------|--------|-------|
| `.epub` | `application/epub+zip` | `reader.html` (new tab) | EPUB.js |
| `.pdf` | `application/pdf` | `PdfViewer` | pdf.js page rendering, highlight/text/line annotations, save via pdf-lib |
| `.txt` | `text/plain` | `TxtViewer` | FileReader |
| `.md` | `text/markdown` | `MarkdownEditor` | Live preview, slash commands, image assets |
| `.youtube` | `application/x-youtube` | `YoutubeViewer` | JSON blob `{url, title}` — iframe embed |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3.1 (no JSX — uses `React.createElement()`) |
| Build | Vite 6.2.0 |
| Styling | Tailwind CSS (CDN) |
| Storage | IndexedDB (`InfoDepo` database, schema version 6, stores: `books`, `notes`, `videos`, `images`, `channels`, `shares`, `pdfAnnotations`) |
| EPUB rendering | EPUB.js (CDN) |
| Auth (dev only) | Google OAuth 2.0 via Google Identity Services |
