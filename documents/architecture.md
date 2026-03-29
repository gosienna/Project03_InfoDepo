# Architecture

## Overview

Zenith Reader is a fully client-side e-book reader. No backend server. All data lives in the browser.

```
User
 └── Browser
      ├── React App (Vite, port 3001)
      │    ├── Library view      — book grid, file import
      │    └── Reader view       — PDF / TXT inline viewers
      ├── reader.html            — standalone EPUB reader (new tab)
      └── IndexedDB              — local book storage (shared by both pages)
```

## Component Tree

```
App.js
├── Header.js               # Nav bar, back button
├── Library.js              # Book grid, file upload, dev Drive browser
│   ├── BookCard.js         # Individual book item + delete
│   └── DevDriveBrowser.js  # Dev-only: OAuth + Drive API folder browser
└── Reader.js               # Dispatches to viewer by file extension / MIME type
    ├── PdfViewer.js        # PDF via iframe + object URL
    ├── TxtViewer.js        # Plain text via FileReader
    └── UnsupportedViewer.js
```

## Data Flow

```
Import (local file)
  input[type=file] → File (Blob) → useIndexedDB.addBook() → IndexedDB

Import (dev Drive)
  DevDriveBrowser → OAuth → Drive API v3 → Blob → useIndexedDB.addBook() → IndexedDB

Open book
  BookCard click → App.handleSelectBook(book)
    ├── EPUB → window.open('/reader.html?id=X')
    │           └── reader.html reads IndexedDB by ID → EPUB.js
    └── PDF/TXT → Reader.js → inline viewer component
```

## Key Files

| File | Role |
|------|------|
| `App.js` | Root — view state, book selection routing |
| `hooks/useIndexedDB.js` | All IndexedDB CRUD. Schema: `{id, name, type, data (Blob), size, added}` |
| `reader.html` | Standalone EPUB reader page, no React |
| `utils/fileUtils.js` | File extension extraction, byte size formatting |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3.1 (no JSX — uses `React.createElement()`) |
| Build | Vite 6.2.0 |
| Styling | Tailwind CSS (CDN) |
| Storage | IndexedDB |
| EPUB rendering | EPUB.js (CDN) |
| Auth (dev only) | Google OAuth 2.0 via Google Identity Services |
