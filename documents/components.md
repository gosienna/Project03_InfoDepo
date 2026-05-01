# Web App Structure & React Components

## Startup sequence

1. `index.js` mounts `App`.
2. `useIndexedDB()` initializes `InfoDepo` (schema v7), loads merged `items` and `channels`.
3. If Google credentials are configured and no valid token exists, show `GoogleLoginGate`.
4. Resolve user role from `VITE_MASTER` + `config.json` users map.
5. For `master`/`editor`, run `DriveFolderGate` until folder ID exists.
6. Render `Header` + `Library`/`Reader`/`YoutubeChannelViewer`.

## Top-level components

### `App.js`

- Root router for `library`, `reader`, and `channel` views.
- Owns role resolution (`master`/`editor`/`viewer`/`unauthorized`).
- Wires all `useIndexedDB` helpers into `Library` and `Reader`.
- Calls `touchItemVisit(id, idbStore)` whenever `currentVideo` changes (tracks last-opened time for LRU eviction).
- Runs `checkAndEvict()` once after `dataReady` to enforce the storage quota on startup.

### `Header.js`

- Displays app title, back button, user email.
- Shows role badge (`Master`, `Editor`, `Viewer`) above the email.
- Shows `Manage Users` button for `master` only.
- Hides Library/Explorer mode switch for `viewer`.

### `UserConfigModal.js`

- Master-only editor for Drive-hosted `config.json`.
- Uses row-based `users` map (`email -> { role, folderId }`).
- Viewer rows show `N/A` for folder ID.
- Uses broad scope (`CONFIG_MANAGE_SCOPE`) so existing `config.json` can be updated.

### `Library.js`

- Unified grid for items and channels (no share tiles).
- Handles:
  - upload/delete/rename/tag
  - per-item sharing (`sharedWith`) via `DataTile`
  - Drive sync (`runOwnerSyncPipeline`)
  - immediate ACL reconcile on sharing updates
  - owner index write (`_infodepo_index.json`)
  - viewer peer sync (`syncSharedFromPeers`)
- Viewer peer sync now also prunes revoked peer-owned content from local IndexedDB.
- **System Settings → Storage**: shows a progress bar of used vs. limit, and an input to adjust the GB cap (saved via `saveSyncSettings`).

### `DataTile.js`

- Used for `tileType: 'item'` and `tileType: 'channel'`.
- Includes tag editor and "Shared with" row when `canShare` is true.
- Share recipient options come from `config.json` users map excluding current user.

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

