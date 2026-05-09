# Drive synchronization

InfoDepo synchronization is now based on owner folders plus item-level sharing metadata (`sharedWith`), not share-link JSON files.

## Code map

| File | Role |
|------|------|
| `utils/libraryDriveSync.js` | `runOwnerSyncPipeline` orchestration |
| `utils/driveSync.js` | backup and folder pull implementation; recognizes `.desk.json` files |
| `utils/ownerIndex.js` | write/read `_infodepo_index.json` |
| `utils/peerSync.js` | peer discovery/download/prune for shared content |
| `components/Library.js` | owner `runOwnerSync` (manual Sync + one startup run per page load); registers sync with `App.js` header; viewer peer sync |
| `App.js` | Header **Sync** calls the owner sync function registered from `Library` (`syncFnRef`); `Library` stays mounted (hidden) so Sync works from desk/reader views |

## Owner pipeline

`runOwnerSyncPipeline(...)` executes:

1. **Backup local -> Drive** (`backupAllToGDrive`)
2. **Pull Drive -> local** (`syncDriveToLocal`, with `lazyBooks: true`)
3. **Write owner index** (`writeOwnerIndex`)
4. **Peer sync** (`syncSharedFromPeers`, with `lazyBooks: true`) when config is available

Returned summary includes `backed`, `backupFailed`, `added`, `updated`, `skipped`, `removed`, `peerAdded`, `peerRemoved`, `peerFailed`.

Desk records are backed up as `<name>.desk.json` with `_type: 'infodepo-desk'` marker. The pull step recognizes this marker and calls `upsertDriveDesk` to sync desk layouts from Drive.

## Lazy book loading

Binary book files (EPUB, PDF, TXT — anything with a non-JSON, non-Markdown MIME type) are synced in **metadata-only mode** during both owner pull and peer sync. The blob is not downloaded at sync time; only the Drive metadata (name, driveId, mimeType, size, modifiedTime) is stored with `data: null`.

**On click**, `App.js`'s `openItem` handler detects `data === null && driveId` for EPUB/PDF items and downloads the blob in the library tab before opening the reader tab. This keeps the user on the library page during the download so the progress overlay on the DataTile is visible. Once the blob is saved to IndexedDB, the reader tab is opened with data already cached. If the library-tab download fails, the reader tab (`reader-entry.js` / `pdf-reader-entry.js`) falls back to its own download path using the OAuth token cached in `localStorage`.

**Visual indicator**: `DataTile` renders a cloud-download icon on tiles whose `data` is null and `driveId` is set. During an active download the icon is replaced by a progress overlay (bytes downloaded / total, percentage, animated progress bar). The overlay is driven by `itemDownloadProgress` — a per-blobKey progress map passed from `App.js` to both `Library` and `Desk` so tiles are updated regardless of which view the user is in.

**Tab refresh**: when the user returns to the library tab after reading, a `visibilitychange` handler calls `loadItems()` to clear the cloud icon for items that were downloaded in the reader tab.

**Exceptions — always downloaded eagerly:**
- `application/json` files (must be parsed to detect YouTube entries, channels, desks)
- `text/markdown` notes (small text files)
- Cover image sidecars (small; needed for tile thumbnails)
- PDF annotation sidecars (small JSON)

**When it runs:** There is no background timer for desks alone. The full pipeline runs only when **owner sync** runs (see below).

## Viewer shared-content sync

For `viewer`, `Library.js` triggers `syncSharedFromPeers` once after role/config are ready:

1. list peers from `config.users` that have `folderId`
2. fetch each peer's `_infodepo_index.json`
3. keep entries where `sharedWith` contains viewer email
4. **prune** peer-owned local rows no longer shared
5. upsert remaining shared entries — binary books as metadata-only (`lazyBooks: true`), JSON eagerly
6. for each book entry with `coverImageDriveId`, download and store the cover sidecar (always eager)

This keeps viewer IndexedDB aligned when owner revokes sharing.

## Cover image sidecar backup and sync

Cover images set on items (books/notes/videos) are backed up to Drive as a sidecar file alongside the main content file:

**Filename convention:** `${item.name}.infodepo-cover.${ext}` where `ext` is derived from the cover MIME type (`jpg`, `png`, `webp`, `gif`, or `bin`).

**Detection helper:** `isCoverSidecarFilename(name)` — returns true when the filename contains `.infodepo-cover.`. Exported from `utils/driveSync.js`.

**Backup flow (`backupAllToGDrive`):**
1. After PDF annotation sidecars are uploaded, iterate all items.
2. For each item with `coverImage.data && !coverImageDriveId`: POST the cover blob as `${item.name}.infodepo-cover.${ext}`.
3. Call `onSetCoverImageDriveSync(itemId, storeName, { coverImageDriveId, modifiedTime })` to persist the Drive file ID.

**Download flow (`syncDriveToLocal`):**
- In Phase 2 (image files), before note-image matching: detect `.infodepo-cover.` filenames.
- Download blob → call `upsertDriveCoverImage({ driveId, parentItemName, mimeType, modifiedTime }, blob)`.
- `parentItemName` is derived by stripping `.infodepo-cover.${ext}` from the filename.

**IDB functions:**
- `setCoverImageDriveSync(itemId, storeName, { coverImageDriveId, modifiedTime })` — persists Drive ID after upload.
- `upsertDriveCoverImage(driveFile, blob)` — finds parent item by name, stores `coverImage: { name, type, data }` and `coverImageDriveId`.
- `setNoteCoverImage` — clears `coverImageDriveId: null` on the record so the next backup re-uploads.

**Owner index:** `coverImageDriveId` is included in each item's index entry when present, enabling receivers to discover and download the cover sidecar directly.

**Peer sync:** After downloading each shared item, if `entry.coverImageDriveId` is set, the cover blob is fetched and passed to `upsertDriveCoverImage`.

**Drive permissions:** `applySharedWithToDriveFiles` also grants reader access to `coverImageDriveId` files when an item is shared.

## Desk backup and sync

Desk records are serialized to JSON and uploaded to the owner's Drive folder as `<name>.desk.json`.

File format:
```json
{
  "_type": "infodepo-desk",
  "name": "My Desk",
  "layout": { "notes:3": { "x": 120, "y": 80 }, "channel:1": { "x": 400, "y": 200 } },
  "tags": [],
  "sharedWith": [],
  "ownerEmail": "user@example.com"
}
```

The `DESK_JSON_MARKER = 'infodepo-desk'` constant is exported from `utils/driveSync.js`. During `syncDriveToLocal`, downloaded JSON with `_type === 'infodepo-desk'` is routed to `upsertDriveDesk` in `hooks/useIndexedDB.js`.

### Local edits (IndexedDB)

Layout, connections, text items, rename, tags, and sharing updates are written to IndexedDB immediately (`setDeskLayout`, `setDeskConnections`, `setDeskTextItems`, etc.). Each save bumps **`localModifiedAt`**. Nothing is sent to Drive until the next **owner sync** runs.

### When the desk is uploaded to Drive

Uploads happen inside **`backupAllToGDrive`**, which runs as **step 1** of `runOwnerSyncPipeline` (before the pull). A desk is uploaded when `deskNeedsBackupUpload` in `utils/driveSync.js` is true: missing **`driveId`**, or **`localModifiedAt` > `modifiedTime`** (same idea as other library rows).

**Owner sync is triggered:**

1. **Once per browser page load** — After Drive credentials and folder id are available, `Library.js` schedules a single background `runOwnerSync` (`setTimeout(..., 0)`), guarded by a module-level flag so it does not double-fire under React Strict Mode.
2. **Manual Sync** — The header Sync action runs the same `runOwnerSync` (function is registered from `Library` into `App.js`).

There is **no** per-edit or debounced upload for the desk alone; rely on startup sync or Sync after editing.

### When the desk file is pulled from Drive

**`syncDriveToLocal`** (pipeline **step 2**) lists the folder, downloads each syncable file, and parses JSON. Desk files are applied via **`upsertDriveDesk`**.

- **Existing row** (matched by **`driveId`** on the desk store): the local row is updated only if the **Drive file `modifiedTime` is newer** than the desk row’s stored **`modifiedTime`**. Otherwise the upsert returns `skipped` (local already reflects that revision or newer).
- **No local row** for that `driveId`: a **new** desk row is **added** from the JSON payload.

Because **backup runs before pull** in the same sync, dirty local desks are normally uploaded first; the pull step then compares against the updated `modifiedTime` from the upload response.

## Dirty detection

- `modifiedTime`: last known Drive revision time (per row).
- `localModifiedAt`: local edit timestamp.
- **Backup upload** (items, channels, desks): when `driveId` is missing or **`localModifiedAt` > `modifiedTime`** (`deskNeedsBackupUpload` for desks, analogous helpers for other kinds in `utils/driveSync.js`).
- **Pull into an existing desk**: `upsertDriveDesk` uses **Drive `modifiedTime` vs stored `modifiedTime`** only (not `localModifiedAt`); see **Desk backup and sync** above.

## Rendering strategy during sync

Sync paths use silent upserts and a final `loadAll()` flush:

- pipeline writes pass `{ silent: true }`
- at end, `loadAll()` refreshes `items`, `channels`, and `desks` in one batch

This avoids repeated rerenders during long sync runs.

## ACL + index refresh on sharing updates

When owner changes an item's `sharedWith` in `Library.js`:

1. local `setItemSharedWith`
2. targeted ACL reconcile (`applySharedWithToDriveFiles`)
3. owner index rewrite (`writeOwnerIndex`) so viewers can discover changes immediately

## Related docs

- [sharing-mechanism.md](sharing-mechanism.md)
- [google-drive-integration.md](google-drive-integration.md)
- [data-stores.md](data-stores.md)
