# Web App Structure & React Components

## Startup sequence

1. `index.js` mounts `App`.
2. `useIndexedDB()` initializes `InfoDepo` (schema v8), loads merged `items`, `channels`, and `desks`.
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

### `Header.js`

- Displays app title, back button, user email.
- Shows role badge (`Master`, `Editor`, `Viewer`) above the email.
- Shows gear **System Settings** button for `editor` and `master` (calls `onSystemSettings` prop provided by App).
- Shows `Manage Users` button for `master` only.
- Mode toggle shows **Library / Desk / Explorer** buttons; hidden entirely for `viewer`.

### `UserConfigModal.js`

- Master-only editor for Drive-hosted `config.json`.
- Uses row-based `users` map (`email -> { role, folderId }`).
- Viewer rows show `N/A` for folder ID.
- Uses broad scope (`CONFIG_MANAGE_SCOPE`) so existing `config.json` can be updated.

### `Library.js`

- Unified grid for items, channels, and desks.
- Handles:
  - upload/delete/rename/tag
  - per-item sharing (`sharedWith`) via `DataTile`
  - Drive sync (`runOwnerSyncPipeline`, including desk backup/pull)
  - immediate ACL reconcile on sharing updates
  - owner index write (`_infodepo_index.json`)
  - viewer peer sync (`syncSharedFromPeers`)
- Desk tiles appear alongside item/channel tiles; clicking a desk tile switches to Desk mode.
- Uses `AddContentDropdown` (receives `onOpenNewNote`, `onOpenYoutube`, `onOpenChannel`, `onOpenFile` callbacks from App). "New Desk" option prompts for name and creates the desk.
- Viewer peer sync also prunes revoked peer-owned content from local IndexedDB.
- **System Settings modal** still rendered here (uses Library-local state for Drive folder, display policy, sign-out, clear). `isSystemSettingsOpen`/`setIsSystemSettingsOpen` are lifted to App and passed as props; the trigger button lives in `Header`.
- **System Settings → Storage**: shows a progress bar of used vs. limit, and an input to adjust the GB cap (saved via `saveSyncSettings`).
- **Search bar**: clicking the input opens a dropdown that contains type filter tabs (Books / Notes / Videos / Channels / Desks) at the top and text/tag suggestions below. Active filters appear as removable pills below the input when the dropdown is closed. The `×` button clears both query and all active filters.

### `DataTile.js`

- Used for `tileType: 'item'` and `tileType: 'channel'`.
- Includes tag editor and "Shared with" row when `canShare` is true.
- Share recipient options come from `config.json` users map excluding current user.

### `Desk.js`

- Full-screen infinite canvas with dot-grid background.
- Pan: middle-mouse drag or Space+left-drag (pointer capture for reliability).
- Zoom: wheel event toward cursor.
- Items are placed as `DataTile` (items/channels) or `DeskTile` (nested desks) with a drag handle bar. Clicking an item opens it; clicking a nested desk switches to that desk.
- Layout stored in a ref during drag, committed to IndexedDB on drag-end to avoid excessive writes.
- **Top-center title**: `DeskSelector` is rendered at `top: 16, left: 50%` as the desk title. Shows the current desk name in large bold text. When multiple desks exist a chevron appears and clicking opens a dropdown to switch desks. The dropdown also exposes a pencil icon per row for inline rename (Enter/Escape/blur to commit/cancel).
- **Top-right toolbar** (editor/master only) contains two controls in a row:
  - **`InlineAddSearch`** (local component) — search input with floating dropdown. Type filter tabs (All / Books / Notes / Videos / Images / Channels / Desks) appear in the dropdown header. Text search matches both item names and tags. Matching tags appear as clickable suggestion pills; active tag filters shown as removable indigo pills. Results show up to 2 tag chips per row. Click a result to place it at the viewport center.
  - **`AddContentDropdown`** — creates new content; newly added items are auto-placed on the current desk by `addToDeskIfActive` in App.
- Props: `{ desk, items, channels, desks, onSelectItem, onSelectChannel, onSelectDesk, onUpdateLayout, onRenameDesk, readOnly, onOpenNewNote, onOpenYoutube, onOpenChannel, onOpenFile }`

### `AddContentDropdown.js`

- Reusable dropdown button used in both `Library` and `Desk`.
- Props: `{ onNewNote, onAddYoutube, onAddChannel, onAddFile, onAddDesk? }`.
- Manages its own open/closed state; each item closes the menu then calls the corresponding prop.

### `DeskTile.js`

- Library grid tile for a desk record (same visual shell as `DataTile`).
- Shows SVG dot-grid hero, desk icon, item count, "Desk" badge, and inline rename.
- Delete button visible on hover (non-readOnly only).
- Props: `{ desk, onSelect, onDelete, onRename, readOnly }`

### `Reader.js`

- Dispatches viewers by extension/MIME:
  - EPUB -> `reader.html` (new tab)
  - PDF -> `PdfViewer`
  - TXT -> `TxtViewer`
  - Markdown -> `MarkdownEditor`
  - YouTube -> `YoutubeViewer`

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
- `utils/peerSync.js`: viewer discovery, download, and prune.
- `utils/driveSharePermissions.js`: applies Drive ACLs from `sharedWith`.
- `utils/libraryDriveSync.js`: backup + pull + owner index + peer sync orchestration.

## Notes

- Legacy share-link UI/files were removed.
- Role-based behavior is centralized in `App.js` + `Library.js`.
- For sharing details, see [sharing-mechanism.md](sharing-mechanism.md).

