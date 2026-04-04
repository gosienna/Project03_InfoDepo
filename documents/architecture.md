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
├── Library.js              # Item grid, file upload, YouTube modal, Drive browser
│   ├── VideoCard.js        # Individual item card + delete
│   ├── NewNoteModal.js     # Create a new Markdown note
│   ├── NewYoutubeModal.js  # Add a YouTube video or channel link
│   └── DevDriveBrowser.js  # Dev/prod: OAuth + Drive API folder browser
└── Reader.js               # Dispatches to viewer by file extension / MIME type
    ├── PdfViewer.js        # PDF via iframe + object URL
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
  VideoCard click → App.handleSelectVideo(video)
    ├── EPUB    → window.open('/reader.html?id=X')
    │             └── reader.html reads IndexedDB 'books' store by ID → EPUB.js
    ├── PDF/TXT → Reader.js → inline viewer component
    ├── MD      → Reader.js → MarkdownEditor
    └── YouTube → Reader.js → YoutubeViewer (iframe embed)
```

## Key Files

| File | Role |
|------|------|
| `App.js` | Root — view state, item selection routing |
| `hooks/useIndexedDB.js` | All IndexedDB CRUD. Three stores: `books` (files), `videos` (YouTube), `assets` (images). See [data-stores.md](data-stores.md) |
| `components/VideoCard.js` | Item card — shows YouTube thumbnail for YouTube items, BookIcon for others |
| `components/YoutubeViewer.js` | Embeds YouTube video via `youtube-nocookie.com/embed/{id}` iframe |
| `components/NewYoutubeModal.js` | Modal to save a YouTube URL as a `application/x-youtube` JSON blob |
| `reader.html` | Standalone EPUB reader page, no React |
| `utils/fileUtils.js` | File extension extraction, byte size formatting |
| `utils/driveSync.js` | Drive sync engine — quota management, metadata-only stubs |

## Supported Content Types

| Extension | MIME type | Viewer | Notes |
|-----------|-----------|--------|-------|
| `.epub` | `application/epub+zip` | `reader.html` (new tab) | EPUB.js |
| `.pdf` | `application/pdf` | `PdfViewer` | iframe + object URL |
| `.txt` | `text/plain` | `TxtViewer` | FileReader |
| `.md` | `text/markdown` | `MarkdownEditor` | Live preview, slash commands, image assets |
| `.youtube` | `application/x-youtube` | `YoutubeViewer` | JSON blob `{url, title}` — iframe embed |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3.1 (no JSX — uses `React.createElement()`) |
| Build | Vite 6.2.0 |
| Styling | Tailwind CSS (CDN) |
| Storage | IndexedDB (`InfoDepo` database, schema version 1, stores: `books`, `notes`, `videos`, `assets`) |
| EPUB rendering | EPUB.js (CDN) |
| Auth (dev only) | Google OAuth 2.0 via Google Identity Services |
