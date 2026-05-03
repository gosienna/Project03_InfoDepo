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
2. **Pull Drive -> local** (`syncDriveToLocal`)
3. **Write owner index** (`writeOwnerIndex`)
4. **Peer sync** (`syncSharedFromPeers`) when config is available

Returned summary includes `backed`, `backupFailed`, `added`, `updated`, `skipped`, `removed`, `peerAdded`, `peerRemoved`, `peerFailed`.

Desk records are backed up as `<name>.desk.json` with `_type: 'infodepo-desk'` marker. The pull step recognizes this marker and calls `upsertDriveDesk` to sync desk layouts from Drive.

**When it runs:** There is no background timer for desks alone. The full pipeline runs only when **owner sync** runs (see below).

## Viewer shared-content sync

For `viewer`, `Library.js` triggers `syncSharedFromPeers` once after role/config are ready:

1. list peers from `config.users` that have `folderId`
2. fetch each peer's `_infodepo_index.json`
3. keep entries where `sharedWith` contains viewer email
4. **prune** peer-owned local rows no longer shared
5. download and upsert remaining shared entries

This keeps viewer IndexedDB aligned when owner revokes sharing.

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
