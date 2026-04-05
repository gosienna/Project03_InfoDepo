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

### 3. `App.js` — IndexedDB, then Google Drive gate (when configured)

On mount, `useIndexedDB()` opens IndexedDB (`InfoDepo`; version from [`utils/infodepoDb.js`](../utils/infodepoDb.js)) and loads merged `items` (books + notes + videos), `channels`, and `shares`. See [data-stores.md](data-stores.md) for object stores and schema.

After the database is ready, the app decides whether the user must complete **Google Drive setup** before any library UI appears:

- [`utils/driveOAuthGateCheck.js`](../utils/driveOAuthGateCheck.js) — `needsDriveOAuthLogin()` returns `true` only when **both** `VITE_CLIENT_ID` and `VITE_API_KEY` are set (see [`utils/driveCredentials.js`](../utils/driveCredentials.js)) **and** either:
  - no Drive folder ID is stored in `localStorage` ([`utils/driveFolderStorage.js`](../utils/driveFolderStorage.js), key `infodepo_drive_folder_id`), or
  - there is no **non-expired** stored OAuth access token for the **current library mode** (owner vs shared use different scopes — [`utils/driveScopes.js`](../utils/driveScopes.js); tokens are keyed in [`utils/driveOAuthStorage.js`](../utils/driveOAuthStorage.js)).
- If `VITE_CLIENT_ID` or `VITE_API_KEY` is missing, the gate is skipped and the library loads without that step (local-only / no env configuration).
- When the gate is required, the user sees [`GoogleOAuthGate.js`](../components/GoogleOAuthGate.js): enter or paste the Drive folder ID, then **Save folder & continue with Google** runs Google Identity Services (GIS), stores the token, fetches profile email for the header, and only then mounts the main shell.

Switching **library mode** (owner ↔ shared) can require signing in again if there is no valid token yet for the other scope.

### 4. Loading states

```
isInitialized = false     →  "Initializing Database..." spinner (full screen)
isInitialized = true      →  one frame: "Checking Google sign-in…" (oauthGatePending)
then:
  needsDriveOAuthLogin()  →  full-screen GoogleOAuthGate (folder + Google sign-in)
  else                    →  Header + main (Library, or Reader / YoutubeChannelViewer by view)
```

---

## Page Structure

### Main App (`index.html` + React)

```
<body>
  <div id="root">                        ← React mounts here
    <App>
      — GoogleOAuthGate (full screen)     ← when VITE_CLIENT_ID + VITE_API_KEY and folder/token incomplete
      — or Header + main after sign-in:
          <Header userEmail? />
          <main>
            <Library />                  ← view = 'library'
            OR <YoutubeChannelViewer />  ← view = 'channel'
            OR <Reader />                ← currentVideo (PDF / TXT / MD / YouTube)
          </main>
    </App>
  </div>
```

### EPUB Reader (`reader.html`)

Standalone page, no React. Opens in a new browser tab. Reads the EPUB from the `books` IndexedDB store by `id` query param.

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
**Role:** Root component. Owns view state, library mode, OAuth gate, and selection routing.

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `view` | `'library' \| 'reader' \| 'channel'` | `'library'` → `Library`; `'reader'` → `Reader` (`currentVideo`); `'channel'` → `YoutubeChannelViewer` (`currentChannel`) |
| `libraryMode` | `'owner' \| 'shared'` | Persisted via `utils/libraryMode.js` — shared mode syncs files the account can read from the linked folder |
| `currentVideo` | `object \| null` | Item being read (non-EPUB in-app) |
| `currentChannel` | `object \| null` | Channel when `view === 'channel'` |
| `googleUserEmail` | `string \| null` | Shown in `Header` after OAuth gate or Library refresh |
| `oauthGatePending` | `boolean` | `true` until first post-DB check of `needsDriveOAuthLogin()` (brief "Checking Google sign-in…") |
| `oauthGateActive` | `boolean` | `true` → render `GoogleOAuthGate` instead of main UI |

**Key logic:**
- After `isInitialized`, `needsDriveOAuthLogin()` (depends on `libraryMode`) controls whether `GoogleOAuthGate` is shown; `recheckDriveOAuthGate` is passed to `Library` so credential/folder changes can re-open the gate if needed.
- `handleSelectVideo` / `openVideo` — EPUB opens `reader.html?id=` in a new tab; other types set `currentVideo` and show `Reader`.
- `handleSelectChannel` — sets `currentChannel` and `view` to `'channel'` for `YoutubeChannelViewer`.
- Delegates IndexedDB to `useIndexedDB` (`items`, `channels`, `shares`, CRUD, tags, share registry, Drive sync helpers).

---

### `Header.js`
**Role:** Top navigation bar.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onBack` | `function \| undefined` | If provided, shows back arrow (reader view only) |
| `userEmail` | `string \| undefined` | Optional signed-in Google email (right side) |

**Renders:** App logo + title. Back button appears when not on the library view (reader or channel).

---

### `GoogleOAuthGate.js`
**Role:** Full-screen first-run (or recovery) screen when Drive OAuth is required: collect the Drive folder ID, persist it via `setDriveFolderId`, then ensure a GIS access token exists for the scope matching `libraryMode` (`getDriveScopeForLibraryMode`), save it with `saveStoredAccessToken`, call `fetchGoogleUserEmail`, invoke `onSuccess` so `App` mounts the main UI.

**Props:**
| Prop | Type | Purpose |
|------|------|-------------|
| `libraryMode` | `'owner' \| 'shared'` | Selects owner vs shared OAuth scope |
| `onSuccess` | `function` | Called after folder + token (+ email fetch attempt) succeed |
| `onGoogleUserEmail` | `function \| undefined` | `(email \| null) => void` for header display |

---

### `Library.js`
**Role:** Library overview — merged item grid, YouTube **channels** grid (owner mode), search/filters, owner vs shared mode, Drive sync/backup, **Shares** (owner editor + receiver viewer via `SharesListModal` / `SharesEditorModal`), and add flows (file, note, YouTube, channel, new share, link share).

**Layout:** Two sections use the **same responsive grid** (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6`): **channels** first (hidden in shared mode), then **items**. Both use [`DataTile.js`](DataTile.js).

**Props (representative):**
| Prop | Type | Purpose |
|------|------|---------|
| `items` | `array` | Merged books + notes + videos from `useIndexedDB` |
| `channels` | `array` | `channels` store rows |
| `shares` | `array` | Share configs from the `shares` store (see [data-stores.md](data-stores.md)) |
| `libraryMode` | `'owner' \| 'shared'` | UI for owner backup vs read-only shared sync |
| `onLibraryModeChange` | `function` | Toggle mode |
| `onSelectItem` | `function` | Open item in reader / EPUB tab |
| `onSelectChannel` | `function` | Open `YoutubeChannelViewer` |
| `onAddItem` | `function` | Add local file / note / YouTube item |
| `onDeleteItem` | `function` | Delete library item |
| `onClearLibrary` | `function` | Wipe stores |
| `onSetDriveId` | `function` | Persist Drive file id after upload |
| `onAddChannel` / `onDeleteChannel` | `function` | Channel CRUD |
| `setRecordTags` | `function` | Tag persistence (`idbStore` or `'channels'`) |
| `getMergedLibraryItems` | `function` | Merged books + notes + videos for Drive share ACL resolution |
| `getSharesList`, `addShare`, `updateShare`, `deleteShare` | `function` | `shares` store CRUD |
| `onGoogleUserEmail` | `function \| undefined` | Updates app header email after GIS / userinfo |
| `onDriveCredentialsChanged` | `function \| undefined` | Re-runs `needsDriveOAuthLogin()` after folder or token changes |
| Plus Drive sync helpers | … | `getBookByDriveId`, `upsertDriveBook`, images, `upsertDriveChannel`, etc. |

**State (representative):**
| State | Purpose |
|-------|---------|
| `searchQuery`, `activeFilters` | Filter items and channels (e.g. by store type) |
| `isDevBrowserOpen` | `DevDriveBrowser` modal — import files from the linked Drive folder |
| `isNewNoteOpen`, `isYoutubeOpen`, `isChannelOpen` | Add modals |
| `isSharesListOpen`, `activeShare` | Shares list and editor/viewer |
| `isSystemSettingsOpen`, `isAddMenuOpen` | Menus (system settings: folder draft, OAuth, etc.) |
| `uploadStatuses` | Per-tile Drive upload state; keys include `libraryItemKey(item)` and `channel-${id}` for channels |
| `credentials`, `driveFolderId`, `driveFolderDraft` | From `getDriveCredentials()` / `getDriveFolderId()`; draft edits folder before save |
| `isSyncing`, `syncResult`, `syncProgress` | Combined sync + backup |
| `availableTags` | Union of tags from items and channels (for `DataTile` and share editor) |

**Toolbar / actions (simplified):** Drive folder browser, **Sync** (owner backup + sync), **Shares**, **Mode: owner / shared**, search, filter chips (Books / Notes / Videos / Channels), add menu (file, note, YouTube, channel, new share, link share), system settings, clear library.

**File upload:** Hidden file input → `onAddItem(name, type, file)`.

**Empty / no-results:** Placeholders when the filtered grid is empty or shared sync has nothing yet.

---

### `SharesListModal.js` / `SharesEditorModal.js`
**Role:** **Shares list** — new share, link share by Drive file id, open row in editor or viewer. **Editor** — owner sets filename, recipient emails, include-by-tag and explicit items with `driveId`; **Save & upload** writes [`utils/sharesDriveJson.js`](../utils/sharesDriveJson.js) JSON to the linked folder via [`utils/sharesDriveFile.js`](../utils/sharesDriveFile.js) and runs [`applyShareRecordsToDriveFiles`](../utils/driveSharePermissions.js). **Receiver** — read-only with optional refresh from Drive.

---

### `DataTile.js`
**Role:** Single component for library **items** (`tileType: 'item'`) and **YouTube channels** (`tileType: 'channel'`). Both use the same Tailwind shell (`DATA_TILE_SHELL` in source: rounded card, shadow, `w-full`, hover lift) so tile **width** matches whatever grid column `Library.js` assigns.

**Props (`tileType: 'item'`):**
| Prop | Type | Purpose |
|------|------|---------|
| `item` | `object` | `{ id, name, type, data, size, idbStore, tags?, ... }` |
| `onSelect` | `function` | Opens the item |
| `onDelete` | `function` | `(id, type) => void` — routed to the correct store |
| `onUpload` | `function` | `(item) => void` — multipart upload to Drive folder |
| `uploadStatus` | `null \| 'uploading' \| 'success' \| 'error'` | Drive upload state |
| `onSetTags` | `function \| undefined` | `(item, tags) => void` — `setRecordTags(id, idbStore, tags)` |
| `readOnly` | `boolean` | Hides upload, delete, tag editing (shared viewer) |
| `availableTags` | `string[]` | Suggestions for the tag dropdown |

**Props (`tileType: 'channel'`):**
| Prop | Type | Purpose |
|------|------|---------|
| `channel` | `object` | `channels` store record (`name`, `thumbnailUrl`, `videos[]`, `tags`, `driveId`, …) |
| `onSelect` | `function` | Opens `YoutubeChannelViewer` |
| `onDelete` | `function` | `(id) => void` — e.g. `deleteChannel` |
| `onUpload` | `function` | `(channel) => void` — uploads `{ _type: 'infodepo-channel', ... }` as `.channel.json` (aligned with `utils/driveSync.js` backup) |
| `uploadStatus` | `null \| 'uploading' \| 'success' \| 'error'` | Per-channel upload state |
| `onSetTags` | `function \| undefined` | `(channel, tags) => void` — `setRecordTags(id, 'channels', tags)` |
| `readOnly` | `boolean` | Same as items |
| `availableTags` | `string[]` | Tag suggestions |

**Item card layout:** `h-40` media (YouTube thumb from blob URL or `BookIcon`), type badge, upload/delete on hover (bottom-right), title, size, tag chips; add-tag **dropdown / new-tag input** are hidden until **hover** on the tag row or **focus-within** (keyboard). Optional IndexedDB hint line for Markdown notes.

**Channel tile layout:** Same shell as items: `h-40` cover (channel avatar or YouTube logo fallback), red **Channel** badge, upload/delete on hover, title, video count, optional handle, tag row (same hover behaviour).

YouTube thumbnails for **items** are resolved asynchronously via `FileReader` on the JSON blob.

---

### `YoutubeChannelViewer.js`
**Role:** Full-page view for a saved YouTube channel — sortable list of non-Shorts videos from the `channels` record.

**Props:** `channel`, `onBack`, `onSelectItem` (opens a video in `Reader` via parent), `onDeleteChannel`.

**UI:** Header with back, avatar, title, delete channel; sort buttons; grid of `DataTile` (`tileType: 'item'`) with synthetic `application/x-youtube` items built from each `videoId` (plus metadata row under each card).

---

### `Reader.js`
**Role:** Format dispatcher. Routes to the correct viewer based on file extension or MIME type.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `video` | `object` | Full item record from IndexedDB |
| `onUpdateItem` | `function` | Persists updated blob (e.g. Markdown saves) |
| `onAddImage` | `function` | Saves image assets for Markdown notes |
| `onGetImages` | `function` | Retrieves image assets for the note |
| `readOnly` | `boolean` | Passed through to `MarkdownEditor` in shared mode |

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
| `onUpdateItem` | `function` | Saves updated Markdown blob |
| `onAddImage` | `function` | Stores an image asset linked to the note |
| `onGetImages` | `function` | Retrieves image assets for the note |
| `readOnly` | `boolean` | Disables editing when true |

**Features:**
- Live preview — transparent textarea overlays rendered HTML; caret stays aligned.
- Slash commands — type `/` at the start of a line for a command menu:
  - Headings (`# `, `## `, `### `)
  - Lists (`- `, `1. `)
  - Images (full / 300px / 500px / 800px)
  - **YouTube embed** — inserts `[Video Title](https://youtube.com/watch?v=)` placeholder
- YouTube link rendering — `[text](youtube-url)` renders as an inline thumbnail card in the preview.
- Image assets — drag-drop, paste, or slash-command insert; stored in the `images` IndexedDB store (see [data-stores.md](data-stores.md)).
- Export as ZIP — `.md` file + `images/` folder.
- Save — Ctrl+S or Save button → `onUpdateItem(id, blob)`.

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

**Credentials:** `clientId` and `apiKey` from `getDriveCredentials()`; `folderId` from `getDriveFolderId()` in `Library.js` (same folder as the OAuth gate).

**Flow:** See [google-drive-integration.md](google-drive-integration.md).

---

### `utils/driveCredentials.js`
**Role:** OAuth client ID and Google API key from the Vite environment (`.env` locally, host env on Netlify). Same variable names everywhere: `VITE_CLIENT_ID`, `VITE_API_KEY`.

| Export | Description |
|--------|-------------|
| `getDriveCredentials()` | Returns `{ clientId, apiKey }` from `import.meta.env` |

The Drive **folder** ID is not part of this object; it lives in `localStorage` via [`utils/driveFolderStorage.js`](../utils/driveFolderStorage.js) (`infodepo_drive_folder_id`), including the value set on `GoogleOAuthGate`.

---

## `useIndexedDB` Hook

Located at [`hooks/useIndexedDB.js`](../hooks/useIndexedDB.js). Encapsulates all IndexedDB access.

**Database:** `InfoDepo` — version `INFO_DEPO_DB_VERSION` from [`utils/infodepoDb.js`](../utils/infodepoDb.js).

**Stores:** `books`, `notes`, `videos`, `images`, `channels`, `shares`. Merged **items** in the UI combine `books` + `notes` + `videos` with `idbStore` and `tags` attached for each row.

**Authoritative schema, field lists, and Drive behaviour:** see **[data-stores.md](data-stores.md)** and [google-drive-integration.md](google-drive-integration.md).

**Returned API (high level):**
| | Description |
|--|-------------|
| `items`, `channels`, `shares` | Arrays for the library UI |
| `addItem`, `updateItem`, `deleteItem`, `clearAll` | Item CRUD across routed stores |
| `addChannel`, `deleteChannel`, `updateChannel`, `upsertDriveChannel`, … | Channel CRUD + Drive |
| `addImage`, `getImagesForNote`, `getAllImages`, … | Note images |
| `setItemDriveId`, `setRecordTags` | Drive ids and per-row tags |
| `getSharesList`, `addShare`, `updateShare`, `deleteShare`, `loadShares` | `shares` store CRUD |
| `getMergedLibraryItems` | Merged rows for Drive share ACL helpers |
| `getBookByDriveId`, `getBookByName`, `upsertDriveBook`, … | Drive sync helpers |

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
  App mounts → useIndexedDB opens InfoDepo and loads items + channels
       │
  isInitialized = false → "Initializing Database…"
       │
       ▼
  isInitialized = true → brief "Checking Google sign-in…"
       │
       ▼
  VITE_CLIENT_ID + VITE_API_KEY set?
       ├── no  → main shell (Library, etc.) — no Google gate
       └── yes → folder ID + valid token for current mode?
                 ├── no  → GoogleOAuthGate (folder + GIS sign-in)
                 └── yes → main shell
       │
       ▼
  Library (grid: channels section + items section) or Reader / YoutubeChannelViewer
       │
  ┌────┴────────────────────────────────────────────┐
  │                                                  │
Add flows (owner)                              Open from grid
  ├── Add file / note / YouTube / channel        ├── Item card → Reader or reader.html (EPUB)
  └── onAddItem / addChannel → IndexedDB         ├── Channel card → YoutubeChannelViewer
       │                                           └── DataTile re-renders on state updates
       ▼
  loadItems() / loadChannels() (inside hook)
```
