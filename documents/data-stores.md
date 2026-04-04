# Data Stores

InfoDepo uses **four** IndexedDB object stores inside the `InfoDepo` database (schema version: **1**).

---

## Overview

| Store    | Contents                              | Drive backup |
|----------|---------------------------------------|--------------|
| `books`  | File-based content (EPUB, PDF, TXT)   | Yes          |
| `notes`  | Markdown notes (`.md`)                | Yes          |
| `videos` | YouTube links (JSON blob)             | Yes — as `.json` |
| `images` | Image attachments for Markdown notes  | Yes          |

The hook `useIndexedDB` (`hooks/useIndexedDB.js`) manages all stores and exposes a unified `items` array (books + notes + videos combined, sorted newest-first by `modifiedTime`).

---

## Unified Record Schema

All four stores use the same base fields:

```js
{
  id: number,           // autoIncrement primary key
  name: string,         // filename, e.g. "MyBook.epub", "My Note.md", "Rick Roll.youtube"
  data: Blob,           // file content — always present, never null
  driveId: string,      // Google Drive file ID; '' if not yet backed up
  type: string,         // MIME type, e.g. "application/pdf", "text/markdown", "image/jpeg"
  size: number,         // bytes
  modifiedTime: Date,   // created or last modified
}
```

The `images` store adds one extra field:

```js
  noteId: number,       // foreign key → notes.id
```

**Removed in v3:** `added`, `driveModifiedTime`, `isMetadataOnly`

---

## Store: `books`

### Purpose
File-based reading content imported from local disk or synced down from Google Drive.

### Supported MIME types

| MIME type               | Extension | Viewer |
|-------------------------|-----------|--------|
| `application/epub+zip`  | `.epub`   | Standalone `reader.html` (new tab) |
| `application/pdf`       | `.pdf`    | `PdfViewer` |
| `text/plain`            | `.txt`    | `TxtViewer` |

### Operations

| Hook function                      | Description |
|------------------------------------|-|
| `addItem(name, type, data)`        | Routes here for EPUB/PDF/TXT MIME types |
| `updateItem(id, content, type)`    | Replace blob; sets `modifiedTime: new Date()` |
| `deleteItem(id, type)`             | Delete record + any linked images |
| `clearAll()`                       | Wipe all four stores |
| `getBookByDriveId(driveId)`        | Look up by Drive file ID (searches books + notes) |
| `getBookByName(name)`              | Look up by filename (searches books + notes) |
| `upsertDriveBook(driveFile, blob)` | Insert or update a Drive-synced record |
| `setItemDriveId(id, store, id)`    | Persist Drive file ID after a successful upload |

---

## Store: `notes`

### Purpose
Markdown notes created or imported by the user, editable in MarkdownEditor.

MIME type: `text/markdown`. `storeForType` and `storeForNewItem` route `.md` files and `text/markdown` MIME type here.

### Operations
Same hook functions as `books`. `getBookByDriveId` and `getBookByName` search both stores in parallel.

---

## Store: `videos`

### Purpose
YouTube video and channel links. Only the URL and title are stored locally (~150 bytes) — no video content.

### Blob content
```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Rick Roll" }
```

### How a YouTube item is created
1. User clicks **"Add YouTube"** → `NewYoutubeModal`
2. URL validated (must contain `youtube.com` or `youtu.be`)
3. `new Blob([JSON.stringify({ url, title })], { type: 'application/x-youtube' })` created
4. `addItem(filename, 'application/x-youtube', blob)` → routed to `videos` store
5. Filename stored as `Rick Roll.youtube`

### Drive backup format
When uploaded to Drive (via upload button or Backup All), the `.youtube` extension and custom MIME type are converted for Drive compatibility:

| Local (IndexedDB) | On Google Drive |
|-------------------|-----------------|
| `Rick Roll.youtube` | `Rick Roll.json` |
| `application/x-youtube` | `application/json` |

The JSON content is identical — Drive can display it as readable text.

### Operations

| Hook function               | Description |
|-----------------------------|-------------|
| `addItem(name, type, data)` | Routes here when `type === 'application/x-youtube'` |
| `deleteItem(id, type)`      | Removes record from `videos` store |

---

## Store: `images`

### Purpose
Image files attached to Markdown notes via MarkdownEditor, linked to their parent note by `noteId`.

### Accepted formats
Any browser-supported image type: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `image/svg+xml`, etc. File input uses `accept="image/*"`; inserts validated with `file.type.startsWith('image/')`.

### Index
- `noteId` — non-unique, for fetching all images belonging to a note.

### Operations

| Hook function                          | Description |
|----------------------------------------|-------------|
| `addImage(noteId, name, data, type)`   | Attach an image to a note |
| `getImagesForNote(noteId)`             | All images for a note (rendered via object URLs in MarkdownEditor) |
| `getAllImages()`                        | All images across all notes (used by Backup All) |
| `deleteImagesForNote(noteId)`          | Called automatically when parent note is deleted |

---

## Store Routing

```js
// Which store an item belongs to, by MIME type
const storeForType = (type) => {
  if (type === 'application/x-youtube') return 'videos';
  if (type === 'text/markdown')         return 'notes';
  return 'books';
};

// addItem also checks filename extension before MIME type
const storeForNewItem = (name, type) => {
  if (name.endsWith('.youtube'))        return 'videos';
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return 'notes';
  return storeForType(type);
};
```

---

## Drive Backup

`driveId` on every record tracks whether the item has been backed up:

| `driveId` value | Meaning |
|-----------------|---------|
| `''` (empty string) | Not yet uploaded to Drive |
| `'1BxiMVs0XRA...'` | Backed up; this is the Drive file ID |

See [google-drive-integration.md](google-drive-integration.md) for the full backup and sync flows.

---

## Schema Version

Current version: **1** — all four stores created in a single upgrade block with the final schema. No migration chain.

To reset the database (e.g. after a schema change during development): DevTools → Application → Storage → Clear site data, then reload.
