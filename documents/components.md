# Web App Structure & React Components

## Startup sequence

1. `index.js` mounts `App`.
2. `useIndexedDB()` initializes `InfoDepo` (schema v9), loads merged `items`, `channels`, and `desks`.
3. If Google credentials are configured and no valid token exists, show `GoogleLoginGate`.
4. Resolve user role from `VITE_MASTER` + `config.json` users map.
5. For `master`/`editor`, run `DriveFolderGate` until folder ID exists.
6. Render `Header` + `Library`/`Reader`/`YoutubeChannelViewer`.

## Top-level components

### `App.js`

- Root router for `library`, `desk`, `reader`, and `channel` views.
- Owns role resolution (`master`/`editor`/`viewer`/`unauthorized`).
- Wires all `useIndexedDB` helpers into `Library`, `Desk`, and `Reader`.
- Tracks `currentDesk` state; switches to `mode='desk'` view when a desk is selected or created.
- Calls `touchItemVisit(id, idbStore)` whenever `currentVideo` changes (tracks last-opened time for LRU eviction).
- Runs `checkAndEvict()` once after `dataReady` to enforce the storage quota on startup.
- Owns `isSystemSettingsOpen` state (lifted from Library) and passes it to `Header` (`onSystemSettings`) and `Library`.
- Owns add-content modal state (`isNewNoteOpen`, `isYoutubeOpen`, `isChannelOpen`), `fileInputRef`, and `handleFileChange`; renders `NewNoteModal`, `NewYoutubeModal`, `NewChannelModal` at the App level so both Library and Desk can trigger them.
- `addToDeskIfActive(store, id)` — called after any modal save or file import; if the current mode is `desk`, appends the new item to the current desk's layout at an offset position.
- **`openItem(item)`** — unified handler for clicking any library tile. For EPUB/PDF: if the blob is absent (`data === null`) the blob is downloaded in the library tab first (so the progress overlay is visible on the tile), then the reader tab is opened with the blob already cached. If the download fails, the reader tab opens anyway and handles the fallback download itself. All other types (images, notes, URLs) download their blob in the library tab on demand before opening inline. `itemDownloadProgress` (a `{ [blobKey]: { loaded, total } }` map) tracks active downloads; it is passed to both `Library` and `Desk` so DataTile tiles in either view can show the progress overlay.
- **`visibilitychange` handler** — calls `loadItems()` when the tab regains focus, so cloud icons clear for books whose blobs were downloaded in a reader tab.

### `Header.js`

- Displays app title, back button, user email.
- Shows role badge (`Master`, `Editor`, `Viewer`) above the email.
- Shows gear **System Settings** button for `editor` and `master` (calls `onSystemSettings` prop provided by App).
- Shows `Manage Users` button for `master` only.
- Mode toggle shows **Library / Desk / Explorer** buttons; hidden entirely for `viewer`.

### `UserConfigModal.js`

- Master-only editor for Drive-hosted `config.json`.
- Uses row-based `users` map (`email -> { role, folderId }`).
- **All roles** (including `viewer`) show an editable folder ID input. For viewers this is the Drive folder used by `runViewerDeskSyncPipeline` for desk backup/pull.
- Uses broad scope (`CONFIG_MANAGE_SCOPE`) so existing `config.json` can be updated.

### `Library.js`

- Unified grid for items, channels, and desks.
- Handles:
  - upload/delete/rename/tag
  - per-item sharing (`sharedWith`) via `DataTile`
  - Drive sync (`runOwnerSyncPipeline`, including desk backup/pull and cover sidecar upload/download)
  - immediate ACL reconcile on sharing updates
  - owner index write (`_infodepo_index.json`)
  - viewer peer sync (`syncSharedFromPeers`, including cover sidecar download)
  - viewer desk sync (`runViewerDeskSyncPipeline`) when viewer has a Drive folder ID in config
- Desk tiles appear alongside item/channel tiles; clicking a desk tile switches to Desk mode.
- Uses `AddContentDropdown` (receives `onOpenNewNote`, `onOpenYoutube`, `onOpenChannel`, `onOpenFile`, `onOpenImage`, `onOpenUrl` callbacks from App). "New Desk" option prompts for name and creates the desk.
- Viewer peer sync also prunes revoked peer-owned content from local IndexedDB.
- **In-body progress banner**: while `isSyncing` is true, a teal spinner banner replaces the sync-result banner and displays `syncProgress` (e.g. `"5 / 68"` or `"Fetching shared content index…"`). The result banner is only shown when `!isSyncing`.
- **Viewer auto-sync**: triggers `runViewerPeerSync` once on mount (after role/config are ready). Calls `setIsSyncing(true/false)` unconditionally in `finally` so the Header spinner and in-body banner are both active for viewers.
- **Background sync guard**: the one-per-load `useEffect` that schedules `runOwnerSync` checks `userType !== 'master' && userType !== 'editor'` before proceeding, preventing viewers from accidentally running the owner backup pipeline.
- **`runOwnerSync` viewer guard**: early-returns immediately if `userType === 'viewer'`.
- **CoverImagePickerModal**: rendered when `coverPickerTarget` is set (via `onSetCoverFromLibrary` on DataTile). Images list is filtered to items with `type.startsWith('image/')` and non-null `data`.
- **System Settings modal** still rendered here (uses Library-local state for Drive folder, display policy, sign-out, clear). `isSystemSettingsOpen`/`setIsSystemSettingsOpen` are lifted to App and passed as props; the trigger button lives in `Header`. The modal is rendered via `ReactDOM.createPortal` into `document.body` so it appears above all views (library, desk, explorer) even when the Library container has `display: none`. z-index is `z-[110]` (above the header's `z-[100]`). The modal box is capped at `max-h-[90vh]` with the body section scrollable (`overflow-y-auto`).
- **System Settings → Storage**: shows a progress bar of used vs. limit, and an input to adjust the GB cap (saved via `saveSyncSettings`).
- **Search bar**: clicking the input opens a dropdown that contains type filter tabs (Books / Notes / Videos / **URLs** / **Images** / Channels / Desks) at the top and text/tag suggestions below. Active filters appear as removable pills below the input when the dropdown is closed. The `×` button clears both query and all active filters. The **URLs** filter (`key: 'url'`) matches items with `type === 'application/x-url'`; **Images** (`key: 'images'`) matches items with `type.startsWith('image/')`; both are independent of "Videos" and "Books".

### `DataTile.js`

- Unified tile component for `tileType: 'item'`, `tileType: 'channel'`, and `tileType: 'desk'`. `DeskTile.js` was merged into this component and removed.
- **Item tiles**: thumbnail (PDF first page, EPUB cover, YouTube screenshot, standalone image blob, or `BookIcon`); file size; tag editor; "Shared with" row; "Set Cover" / "From Library" buttons.
- **Standalone image items** (`type.startsWith('image/')`): `isStandaloneImage` flag renders the `data` blob as the tile thumbnail via an object URL; shows a teal "Image" badge instead of file extension.
- **Channel tiles**: YouTube screenshot hero; channel avatar overlay; video count; tag editor; "Shared with" row.
- **Desk tiles**: dot-grid hero (or custom cover image); item count; inline rename; "Shared with" row; "Set Cover" / "From Library" buttons.
- **Cover images**: all non-channel tile types support a custom cover image. Both "Set Cover" and "From Library" buttons are hidden by default and appear on hover (`opacity-0 group-hover:opacity-100`). After a cover is saved, the custom image takes priority over any auto-generated thumbnail.
- **"From Library" button**: calls `onSetCoverFromLibrary(record)` prop to open `CoverImagePickerModal` with standalone library images.
- **Lazy-load indicator**: when an item has `data === null && driveId` (synced as metadata-only), a cloud-download icon overlays the bottom of the tile hero. When a download is active (`itemDownloadProgress[item.id]` is set), the cloud icon is replaced by a progress overlay showing bytes downloaded / total, a percentage, and an animated progress bar. `itemDownloadProgress` is a `{ [blobKey]: { loaded, total } }` map maintained in `App.js` via a `useRef` + `requestAnimationFrame` loop (to decouple chunk rate from React render rate) and passed to DataTile from both Library and Desk.
- Thumbnail generation effects (PDF first page, EPUB cover) short-circuit when `data` is null — no crash, tile just shows the book icon until the blob is downloaded.
- Includes tag editor and "Shared with" row when `canShare` is true.
- Share recipient options come from `config.json` users map excluding current user.

### `Desk.js`

- Full-screen infinite canvas with dot-grid background.
- Pan: middle-mouse drag or Space+left-drag (pointer capture for reliability).
- Zoom: wheel event toward cursor.
- All canvas tiles (items, channels, and nested desks) are rendered as `DataTile` with the matching `tileType` prop. Each tile has a drag handle bar; clicking opens the item/channel or switches to the nested desk.
- Layout stored in a ref during drag, committed to IndexedDB on drag-end to avoid excessive writes.
- **Auto-share on add**: when `addItemToDesk(key)` is called and the current desk has `sharedWith` recipients, the newly added record is automatically merged with those recipients via `onSetSharedWith`. For newly created nested desks (which are not yet in the `desks` state array), `handleCreateDesk` calls `onSetSharedWith` directly with the known `id` after creation.
- **Top-center title**: `DeskSelector` is rendered at `top: 16, left: 50%` as the desk title. Shows the current desk name in large bold text. When multiple desks exist a chevron appears and clicking opens a dropdown to switch desks. The dropdown has a search input at the top (auto-focused, filters by name, clears on close; Escape closes the dropdown) followed by a scrollable desk list. Each row has a pencil icon for inline rename (Enter/Escape/blur to commit/cancel). Blur is handled via `containerRef` so focus moving to the search input does not accidentally close the dropdown.
- **Top-right toolbar** (editor/master only) contains two controls in a row:
  - **`InlineAddSearch`** (local component) — search input with floating dropdown. Type filter tabs (All / Books / Notes / Videos / Images / Channels / Desks) appear in the dropdown header. Text search matches both item names and tags. Matching tags appear as clickable suggestion pills; active tag filters shown as removable indigo pills. Results show up to 2 tag chips per row. Click a result to place it at the viewport center.
  - **`AddContentDropdown`** — creates new content; newly added items are auto-placed on the current desk by `addToDeskIfActive` in App.
- Props: `{ desk, items, channels, desks, onSelectItem, onSelectChannel, onSelectDesk, onUpdateLayout, onRenameDesk, onSetSharedWith, readOnly, role, onOpenNewNote, onOpenYoutube, onOpenChannel, onOpenFile, onCreateDesk, itemDownloadProgress }`

### `AddContentDropdown.js`

- Reusable dropdown button used in both `Library` and `Desk`.
- Props: `{ onNewNote, onAddYoutube, onAddChannel, onAddFile, onAddImage?, onAddDesk?, onAddUrl? }`.
- `onAddImage`: opens the image-specific file picker (`accept="image/*"`) in `App.js`; imports image as a standalone library item in the `books` store.
- Manages its own open/closed state; each item closes the menu then calls the corresponding prop.

### `CoverImagePickerModal.js`

- Portal modal (`z-[120]`) for selecting a cover image from the image library.
- Props: `{ images, onSelect, onClose }`.
- Renders a 3-column grid of thumbnails from `images` (items with `type.startsWith('image/')` and non-null `data` blob). Object URLs are created on mount and revoked on unmount.
- Click a thumbnail → `onSelect(imageItem)` → caller creates a `File` from `imageItem.data` and calls `setNoteCoverImage`.
- If no images: shows "No images in library yet — import an image first."
- Used by both `Library.js` and `Desk.js` via `coverPickerTarget` state.

### `MarkdownEditor.js`

Markdown note editor with two edit modes and rich inline content.

#### Edit modes

| Mode | How it works |
|------|-------------|
| **HTML Edit** (default) | Single `contenteditable` div initialized from `renderMarkdown`. Edits go directly to the DOM; no re-render loop. Switching to MD mode serializes the DOM back to markdown via `htmlDivsToMarkdown`. |
| **Markdown Edit** | Split-pane: raw markdown textarea (left) + live HTML preview (right, re-rendered on every keystroke). |

#### Slash commands (`/`)

Type `/` at the start of a line to open the command palette:

| Command | Inserts |
|---------|---------|
| `/h1`, `/h2`, `/h3` | Heading at the chosen level |
| `/ul-dash`, `/ul-star`, `/ul-plus` | Unordered list with the chosen marker |
| `/ol` | Numbered list |
| `/image` | Opens local file picker; inserts `![name](file)` |
| `/canvas` | Blank 800×600 drawing canvas (PNG asset) |
| `/youtube` | YouTube link template |
| `/table` | 3×3 markdown table |
| `/math` | Inline math input (`$...$`) |
| `/math-block` | Display-mode math block (`$$...$$`) |
| `/goto` | Section-link picker (jumps to a heading anchor) |

#### Math (LaTeX via KaTeX)

Math is rendered using **KaTeX** (loaded synchronously from CDN in `index.html`).

**Syntax:**
- Inline: `` $E=mc^2$ `` → rendered inline
- Block: `$$\n\frac{x^2}{2}\n$$` (multi-line) or `$$expr$$` (single-line) → centered display block

**Editing workflow in HTML mode:**
1. `/math` or `/math-block` inserts an amber-styled editable field (distinctive `caret-color: #fbbf24`, dashed amber border).
2. Type the LaTeX expression directly into the field.
3. After **3 seconds of inactivity** (or pressing Escape), the field is replaced with the KaTeX-rendered output (`contenteditable="false"`).
4. Press **Backspace** when the cursor is immediately after a rendered math element to revert it to the editable amber field.
5. Blur (click away) commits any open math field immediately.

**Round-trip:** Every rendered element carries `data-latex="<raw expr>"` and `data-display="true|false"`. `htmlDivsToMarkdown` reads these to reconstruct `$...$` / `$$...$$` syntax when switching to MD mode or saving.

**Fallback:** If KaTeX is not yet loaded, the raw expression is shown with amber monospace styling.

#### Tables

Markdown table syntax (`| col | col |` + `|---|---|` separator) is parsed by `renderMarkdown` and rendered as a styled `<table>`. In HTML mode, pressing **Tab** moves the cursor to the next cell; Tab from the last cell appends a new row.

Round-trip: `htmlDivsToMarkdown` serializes `<table>` elements back to pipe-delimited markdown rows.

#### Images

- **Inline size syntax:** `![alt|300](file)` → `width:300px`; `![alt|300x200](file)` → fixed 300×200 with `object-fit:cover`.
- **Drag handle:** Hover an image to reveal a resize handle on its right edge; drag to resize. Width is written back into the markdown `alt` field.
- **Edit button:** Hover reveals an "Edit" button that opens `ImageEditor` for cropping/filtering.
- Paste or drag an image file into the editor to import it as an asset.

#### Key internal functions

| Function | Purpose |
|----------|---------|
| `renderMarkdown(text, assetUrls)` | Markdown → HTML (block-level: tables, math, code, lists, headings, HR, paragraphs; inline: math, images, code, bold, italic, YouTube embeds, links) |
| `inlineMarkdown(text, assetUrls)` | Inline markdown → HTML fragment |
| `renderMath(expr, display)` | LaTeX expr → KaTeX HTML wrapped in `data-latex` element |
| `htmlDivsToMarkdown(el, assetUrls)` | contentEditable DOM → markdown string (round-trip) |
| `commitMathElement(el)` | Render pending math element with KaTeX and lock it |
| `revertMathElement(el)` | Unlock a rendered math element back to amber editable field |

### `Reader.js`

- Dispatches viewers by extension/MIME for inline (same-tab) viewers:
  - PDF → `PdfViewer`
  - TXT → `TxtViewer`
  - Markdown → `MarkdownEditor`
  - YouTube → `YoutubeViewer`
- EPUB / MOBI / AZW / AZW3 are **not** dispatched here for the primary path — `App.js`'s `openItem()` calls `window.open('/reader.html?id=X&store=Y', '_blank')` directly so the book opens in its own tab (avoids `WebKitBlobResource error 1` on iOS/iPadOS).

### `reader.html` / `reader-entry.js`

- Standalone page and React entry for EPUB/MOBI/AZW reading.
- Reads `?id=X&store=Y` from the URL, opens IndexedDB directly, and renders `FoliateViewer`.
- **Lazy blob download**: if the record's `data` is null and `driveId` is set, reads the OAuth token from `localStorage` (`infodepo_drive_oauth_tokens`) and fetches the blob directly from Drive, saves it to IndexedDB, then passes it to `FoliateViewer`. Shows a spinner while downloading. Shows an error if no cached token is found.
- Saves reading position back to IndexedDB without going through the main app's state.
- Both files are Vite build entry points.

### `pdf-reader.html` / `pdf-reader-entry.js`

- Standalone page and React entry for PDF reading (mirrors `reader.html` pattern).
- Reads `?id=X&store=Y`, opens IndexedDB, materializes the blob for iOS Safari compatibility, loads annotations, and renders `PdfViewer`.
- **Lazy blob download**: same token-from-localStorage pattern as `reader-entry.js` — detects `data === null && driveId`, downloads, saves, then materializes and renders. Shows a spinner during download.

### `FoliateViewer.js`

- Wraps the foliate-js `<foliate-view>` custom element. Used only inside `reader.html` (new-tab context).
- Detects renderer type after `view.open()`: `foliate-fxl` (true fixed-layout) vs `foliate-paginator` (reflowable + spread manga).
- Spread manga detection: if every spine section has `pageSpread` set and `view.isFixedLayout` is false, treats the book as spread manga (KCC EPUBs lack standard `rendition:layout` metadata).
- Flow mode:
  - Reflowable text: scrolled by default, togglable to paginated.
  - Fixed-layout (fxl): locked to paginated; layout toggle hidden.
  - Spread manga: scrolled flow on paginator; navigation via `view.goTo(sectionIndex)` to avoid blank boundary columns; Prev/Next shown, toggle hidden.
- Saves/restores reading position as EPUB CFI via `onSaveReadingPosition`.
- Props: `{ data, name, type, itemId, initialReadingPosition, onSaveReadingPosition, storeName }`

### `YoutubeChannelViewer.js`

- Channel detail page with sort/search.
- Auto-checks for new channel videos when mounted.

## Supporting modules

- `utils/userConfig.js`:
  - `fetchUserConfig`
  - `resolveUserType`
  - `getUserFolderId`
  - `listPeerUsers`
  - `listAllUserEmails`
- `utils/ownerIndex.js`: writes/reads `_infodepo_index.json`.
- `utils/peerSync.js`: viewer peer-content discovery, two-phase download (`globalTotal` computed before any downloads start), and prune.
- `utils/driveSync.js`: `syncDriveToLocal` (pre-scans note bundles; unified `X / N` counter across all phases; cover sidecars handled silently in Phase 4) and `backupAllToGDrive`.
- `utils/driveSharePermissions.js`: applies Drive ACLs from `sharedWith`.
- `utils/libraryDriveSync.js`: `runOwnerSyncPipeline` (backup + pull + owner index + peer sync) and `runViewerDeskSyncPipeline` (viewer desk backup + pull only).

## Notes

- Legacy share-link UI/files were removed.
- Role-based behavior is centralized in `App.js` + `Library.js`.
- For sharing details, see [sharing-mechanism.md](sharing-mechanism.md).

