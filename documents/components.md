# Web App Structure & React Components

## Startup Sequence

### 1. Browser loads `index.html`

```
index.html
├── <script> Tailwind CSS (CDN)
├── <script> JSZip (CDN)
├── <script> EPUB.js (CDN)
├── <script> Google Identity Services — gsi/client (CDN, async)
├── <script> Google API — api.js (CDN, async)
├── <script type="importmap"> — maps React bare imports to esm.sh CDN URLs
└── <script type="module" src="./index.js"> — app entry point
```

CDN libraries load in parallel. React is resolved via the importmap — no bundling step.

### 2. `index.js` — React mount

```js
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  React.StrictMode
    └── App
);
```

`React.StrictMode` causes effects to run twice in development (intentional React behaviour for catching side effects).

### 3. `App.js` — first render

On mount, two things happen in parallel:

```
App mounts
├── useIndexedDB() hook initialises
│     └── indexedDB.open('InfoDepo', 4)
│           ├── onupgradeneeded → creates/migrates 'videos' object store
│           └── onsuccess → db instance ready → loadVideos() → setIsInitialized(true)
└── React renders loading spinner (isInitialized = false)
```

Once `isInitialized` becomes `true`, the spinner is replaced with the Library view.

### 4. Loading states

```
isInitialized = false  →  "Initializing Database..." spinner (full screen)
isInitialized = true   →  Library view rendered
```

---

## Page Structure

### Main App (`index.html` + React)

```
<body>
  <div id="root">                        ← React mounts here
    <App>
      <Header />                         ← always visible
      <main>
        <Library />                      ← view = 'library'
        OR
        <Reader />                       ← view = 'reader' (PDF / TXT / MD / YouTube)
      </main>
    </App>
  </div>
```

### EPUB Reader (`reader.html`)

Standalone page, no React. Opens in a new browser tab. Reads from the `videos` IndexedDB store.

```
<body>
  <header>                               ← book title, page counter, close button
  <div id="viewer">                      ← EPUB.js renders here (full page height)
  <div id="loading">                     ← overlay, hidden after render
  <footer>                               ← Prev / Next buttons
```

---

## Component Reference

### `App.js`
**Role:** Root component. Owns view state and item selection routing.

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `view` | `'library' \| 'reader'` | Which view is shown |
| `currentVideo` | `object \| null` | Item being viewed (non-EPUB) |
| `downloadPromptVideo` | `object \| null` | Cloud-only item awaiting download confirmation |

**Key logic:**
- `handleSelectVideo(video)` — if EPUB, calls `window.open('/reader.html?id=X', '_blank')` and returns. All other types set `currentVideo` and switch to reader view. Cloud-only items show a download prompt instead.
- Delegates all IndexedDB operations to `useIndexedDB` hook.

---

### `Header.js`
**Role:** Top navigation bar.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onBack` | `function \| undefined` | If provided, shows back arrow (reader view only) |

**Renders:** App logo + title. Back button appears only when in reader view.

---

### `Library.js`
**Role:** Item grid, file import, YouTube modal, Drive browser trigger (dev + prod).

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `videos` | `array` | List of items from IndexedDB |
| `onSelectVideo` | `function` | Called when an item card is clicked |
| `onAddVideo` | `function` | Saves a new item to IndexedDB |
| `onDeleteVideo` | `function` | Deletes an item by ID |
| `onClearLibrary` | `function` | Clears all items |
| `getVideoByDriveId` | `function` | Drive sync lookup |
| `getVideoByName` | `function` | Drive sync lookup |
| `upsertDriveVideo` | `function` | Drive sync upsert |
| `evictToMetadata` | `function` | Convert items to cloud-only stubs |

**State:**
| State | Purpose |
|-------|---------|
| `isDevBrowserOpen` | Toggles `DevDriveBrowser` modal |
| `isSettingsOpen` | Toggles `DriveSettingsModal` (production only) |
| `isNewNoteOpen` | Toggles `NewNoteModal` |
| `isYoutubeOpen` | Toggles `NewYoutubeModal` |
| `credentials` | `{clientId, apiKey, folderId}` — sourced from `getDriveCredentials()` |
| `driveFolderName` | Display name fetched from Drive API when credentials are valid |
| `uploadStatuses` | Per-item Drive upload state (`null \| 'uploading' \| 'success' \| 'error'`) |

**Toolbar buttons:**
```
DEV: Test Folder   (dev only)  → opens DevDriveBrowser
Drive Folder       (prod only) → opens DriveSettingsModal or DevDriveBrowser
Sync                           → syncDriveToLocal()
New Note                       → opens NewNoteModal
Add YouTube                    → opens NewYoutubeModal
Add File                       → hidden <input type="file"> triggered via ref
🗑 (trash)                     → confirm + onClearLibrary()
```

**File upload flow:**
```
"Add File" clicked
  → hidden <input type="file"> triggered via ref
  → user selects file
  → handleFileChange(e)
  → onAddVideo(file.name, file.type, file)   ← File extends Blob, stored directly
  → input value reset (allows re-selecting same file)
```

**YouTube add flow:**
```
"Add YouTube" clicked
  → NewYoutubeModal opens
  → user enters URL (+ optional title)
  → JSON blob created: { url, title }
  → onAddVideo(filename, 'application/x-youtube', blob)
  → modal closes
```

**Drive button behaviour:**
```
Dev:   yellow "DEV: Test Folder" → opens DevDriveBrowser (credentials from .env)
Prod:  teal "Drive Folder"
         no credentials saved → opens DriveSettingsModal first
         credentials saved    → opens DevDriveBrowser directly
                                 gear icon beside button opens DriveSettingsModal to edit
```

**Empty state:** When `videos.length === 0`, shows a centred placeholder with an "Add Your First File" button.

---

### `VideoCard.js`
**Role:** Single item card in the grid.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `video` | `object` | `{id, name, type, data, size, added, isMetadataOnly?}` |
| `onSelect` | `function` | Opens the item |
| `onDelete` | `function` | Deletes the item |
| `onUpload` | `function` | Uploads to Google Drive |
| `uploadStatus` | `null \| 'uploading' \| 'success' \| 'error'` | Drive upload state |

**Renders:**
```
Card (clickable)
├── Cover area
│   ├── YouTube items  → thumbnail from img.youtube.com/vi/{id}/mqdefault.jpg
│   │                    (red play-button SVG if no video ID, e.g. channel links)
│   └── Other items    → BookIcon
│   ├── Type badge (top-right): red "YouTube" for YouTube, indigo extension for others
│   ├── "☁ Cloud" badge (top-left, cloud-only items only)
│   └── Action buttons (bottom-right, visible on hover)
│       ├── Upload button (Drive)
│       └── Delete button
└── Info area
    ├── Item name (truncated)
    ├── File size (formatted: KB / MB)
    └── "Click to download & read" (cloud-only items only)
```

YouTube thumbnail is extracted asynchronously via `FileReader` reading the JSON blob on mount.

---

### `Reader.js`
**Role:** Format dispatcher. Routes to the correct viewer based on file extension or MIME type.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `video` | `object` | Full item record from IndexedDB |
| `onUpdateVideo` | `function` | Persists updated Markdown content |
| `onAddAsset` | `function` | Saves image assets for Markdown notes |
| `onGetAssets` | `function` | Retrieves image assets for Markdown notes |

**Routing logic:**
```js
ext = getFileExtension(video.name)
   || MIME_TO_EXT[video.type]   // fallback for Drive files without extension

switch(ext):
  'epub'    → EpubViewer       (legacy path, main routing goes to reader.html)
  'pdf'     → PdfViewer
  'txt'     → TxtViewer
  'md'      → MarkdownEditor
  'youtube' → YoutubeViewer
  else      → UnsupportedViewer
```

**MIME_TO_EXT map:**
```js
{
  'application/epub+zip':  'epub',
  'application/pdf':       'pdf',
  'text/plain':            'txt',
  'text/markdown':         'md',
  'application/x-youtube': 'youtube',
}
```

---

### `YoutubeViewer.js`
**Role:** Embeds a YouTube video or shows a link for channel/playlist URLs.

**Props:** `video` (full item record)

**State:** `parsed` (object), `isLoading` (bool), `error` (string|null)

**How it works:**
```js
FileReader.readAsText(video.data)
  onload → JSON.parse → { url, title }
  extractVideoId(url) → 11-char video ID (or null for channels)

videoId present → 16:9 iframe (youtube-nocookie.com/embed/{id}?rel=0)
                   + "Open in YouTube" link
videoId absent  → YouTube logo + "Open in YouTube" link (channel/playlist fallback)
```

---

### `NewYoutubeModal.js`
**Role:** Modal to save a YouTube video or channel URL.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onSave` | `function` | Called with `(filename, 'application/x-youtube', blob)` |
| `onClose` | `function` | Closes the modal |

**Behaviour:**
- URL input is focused on mount.
- Validates that the URL contains `youtube.com` or `youtu.be`.
- Creates a JSON blob: `{ url, title }`.
- Filename: `{title}.youtube` (filesystem-unsafe chars stripped).

---

### `MarkdownEditor.js`
**Role:** Full-featured Markdown editor with live preview and image assets.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `video` | `object` | Note record (`id`, `name`, `data`) |
| `onUpdateVideo` | `function` | Saves updated Markdown blob |
| `onAddAsset` | `function` | Stores an image asset linked to the note |
| `onGetAssets` | `function` | Retrieves image assets for the note |

**Features:**
- Live preview — transparent textarea overlays rendered HTML; caret stays aligned.
- Slash commands — type `/` at the start of a line for a command menu:
  - Headings (`# `, `## `, `### `)
  - Lists (`- `, `1. `)
  - Images (full / 300px / 500px / 800px)
  - **YouTube embed** — inserts `[Video Title](https://youtube.com/watch?v=)` placeholder
- YouTube link rendering — `[text](youtube-url)` renders as an inline thumbnail card in the preview.
- Image assets — drag-drop, paste, or slash-command insert; stored in `assets` IndexedDB store.
- Export as ZIP — `.md` file + `images/` folder.
- Save — Ctrl+S or Save button → `onUpdateVideo(id, blob)`.

---

### `PdfViewer.js`
**Role:** Renders a PDF Blob in an iframe.

**Props:** `data` (Blob)

**How it works:**
```js
objectUrl = URL.createObjectURL(data)  // memoized
<iframe src={objectUrl} />             // browser's built-in PDF renderer
```

---

### `TxtViewer.js`
**Role:** Reads and displays plain text.

**Props:** `data` (Blob)

**State:** `text` (string), `isLoading` (bool)

**How it works:**
```js
FileReader.readAsText(data)
  onload → setText(result) → setIsLoading(false)
```

Displays text in a `<pre>` tag with `whitespace-pre-wrap` to preserve formatting.

---

### `DevDriveBrowser.js`
**Role:** Modal overlay — OAuth login + file list from Google Drive folder. Used in both dev and production.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onFileSelect` | `function` | Called with `(name, mimeType, blob)` on import |
| `onClose` | `function` | Closes the modal |
| `clientId` | `string` | OAuth 2.0 Client ID |
| `apiKey` | `string` | Google API key |
| `folderId` | `string` | Drive folder ID |

**Credentials:** Received as props from `Library.js`, which sources them from `utils/driveCredentials.js` (`.env` in dev, `localStorage` in prod).

**Flow:** See [google-drive-integration.md](google-drive-integration.md).

---

### `DriveSettingsModal.js` *(production only)*
**Role:** Modal form for entering and saving Google Drive credentials in production.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onSave` | `function` | Called with `{clientId, apiKey, folderId}` after saving |
| `onClose` | `function` | Closes the modal without saving |

**Behaviour:**
- Pre-fills fields from `localStorage` (via `getDriveCredentials()`) if credentials were previously saved.
- On submit: calls `saveDriveCredentials()` → saves to `localStorage` → calls `onSave(creds)`.
- "Clear credentials" button calls `clearDriveCredentials()` and empties the fields.

---

### `utils/driveCredentials.js`
**Role:** Single source of truth for Drive credentials.

| Export | Description |
|--------|-------------|
| `getDriveCredentials()` | Returns `{clientId, apiKey, folderId}` — from `import.meta.env` in dev, `localStorage` in prod |
| `saveDriveCredentials(creds)` | Persists credentials to `localStorage` (prod only) |
| `clearDriveCredentials()` | Removes credentials from `localStorage` |

`localStorage` key: `infodepo_drive_credentials`.

---

## `useIndexedDB` Hook

Located at `hooks/useIndexedDB.js`. Encapsulates all database logic.

**Database:** `InfoDepo` (version 4)
**Object stores:** `videos` (primary), `assets` (image attachments for Markdown notes)
**Schema (`videos`):** `{ id (auto), name, type, data (Blob|null), size, added (Date), driveId?, driveModifiedTime?, isMetadataOnly? }`
**Schema (`assets`):** `{ id (auto), noteId, filename, data (Blob), mimeType }`
**Sort order:** Newest first (`added` timestamp descending)

**Migration history:**
| Version | Change |
|---------|--------|
| 1 | Created `videos` store (originally `books`) |
| 2 | Added `assets` store with `noteId` index |
| 3 | Added `driveId` index on `videos`/`books` store |
| 4 | Renamed `books` → `videos` (copy + delete migration) |

**Returned API:**
| | Type | Description |
|--|------|-------------|
| `videos` | `array` | All items, sorted newest-first |
| `isInitialized` | `bool` | False until DB is open and items are loaded |
| `addVideo(name, type, data)` | `async fn` | Adds an item, reloads list |
| `updateVideo(id, blob)` | `async fn` | Updates item data (used by MarkdownEditor) |
| `deleteVideo(id)` | `async fn` | Deletes by ID (also removes linked assets) |
| `clearVideos()` | `fn` | Removes all items and assets |
| `addAsset(noteId, filename, data, mimeType)` | `async fn` | Stores an image asset |
| `getAssetsForNote(noteId)` | `async fn` | Retrieves all assets for a note |
| `getVideoByDriveId(driveId)` | `async fn` | Drive sync lookup |
| `getVideoByName(name)` | `async fn` | Drive sync lookup |
| `upsertDriveVideo(driveFile, blob)` | `async fn` | Create or update Drive-linked record |
| `evictToMetadata(ids)` | `async fn` | Convert items to metadata-only stubs |
| `markAsDownloaded(id, blob)` | `async fn` | Upgrade stub to full local copy |

---

## State Flow Diagram

```
Browser opens app
       │
       ▼
  index.html loads CDNs + importmap
       │
       ▼
  index.js → ReactDOM.createRoot → renders App
       │
       ▼
  App mounts → useIndexedDB initialises IndexedDB (v4, store: 'videos')
       │
  isInitialized = false
       │  (DB opens, items loaded)
       ▼
  isInitialized = true → Library rendered
       │
  ┌────┴────────────────────────┐
  │                             │
User uploads file/URL        User clicks card
  │                             │
  ├── Add File → file picker    ├── EPUB    → window.open(reader.html?id=X)
  ├── Add YouTube → modal       ├── PDF/TXT → Reader.js → PdfViewer / TxtViewer
  └── New Note → modal          ├── MD      → Reader.js → MarkdownEditor
       │                        └── YouTube → Reader.js → YoutubeViewer
       ▼
  addVideo() →
  IndexedDB write →
  loadVideos() →
  videos state updates →
  VideoCard re-renders
```
