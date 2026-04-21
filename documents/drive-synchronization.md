# Drive synchronization

InfoDepo synchronization is now based on owner folders plus item-level sharing metadata (`sharedWith`), not share-link JSON files.

## Code map

| File | Role |
|------|------|
| `utils/libraryDriveSync.js` | `runOwnerSyncPipeline` orchestration |
| `utils/driveSync.js` | backup and folder pull implementation |
| `utils/ownerIndex.js` | write/read `_infodepo_index.json` |
| `utils/peerSync.js` | peer discovery/download/prune for shared content |
| `components/Library.js` | runs manual/startup sync and viewer peer sync |

## Owner pipeline

`runOwnerSyncPipeline(...)` executes:

1. **Backup local -> Drive** (`backupAllToGDrive`)
2. **Pull Drive -> local** (`syncDriveToLocal`)
3. **Write owner index** (`writeOwnerIndex`)
4. **Peer sync** (`syncSharedFromPeers`) when config is available

Returned summary includes `backed`, `backupFailed`, `added`, `updated`, `skipped`, `removed`, `peerAdded`, `peerRemoved`, `peerFailed`.

## Viewer shared-content sync

For `viewer`, `Library.js` triggers `syncSharedFromPeers` once after role/config are ready:

1. list peers from `config.users` that have `folderId`
2. fetch each peer's `_infodepo_index.json`
3. keep entries where `sharedWith` contains viewer email
4. **prune** peer-owned local rows no longer shared
5. download and upsert remaining shared entries

This keeps viewer IndexedDB aligned when owner revokes sharing.

## Dirty detection

- `modifiedTime`: last known Drive revision time
- `localModifiedAt`: local edit timestamp
- Backup uploads when `driveId` missing or `localModifiedAt > modifiedTime`.

## Rendering strategy during sync

Sync paths use silent upserts and a final `loadAll()` flush:

- pipeline writes pass `{ silent: true }`
- at end, `loadAll()` refreshes `items`/`channels` once

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
