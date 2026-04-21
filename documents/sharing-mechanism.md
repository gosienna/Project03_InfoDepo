# Sharing mechanism

This document explains how sharing works after the migration from share-link JSON files to item-level sharing.

## Overview

InfoDepo now stores sharing metadata directly on each library record:

- `sharedWith: string[]` - recipient emails for this item/channel
- `ownerEmail: string` - original owner account for this record

There is no `shares` IndexedDB store and no "link share" workflow anymore.

## Roles and who can share

- `master` and `editor` can edit sharing on records they own.
- `viewer` is read-only and cannot change sharing.
- A record imported from another user is treated as peer-owned and its sharing controls are hidden.

The UI source for selectable users is `config.json` (`users` map), excluding the currently signed-in user.

## Data model

Sharing state is represented in three places:

1. IndexedDB record fields (`sharedWith`, `ownerEmail`)
2. Owner Drive index file: `_infodepo_index.json`
3. Google Drive file permissions (reader ACLs)

The index file is the discovery layer; Drive ACLs are the authorization layer.

## Owner flow (share update)

When an owner changes `sharedWith` from a tile:

1. `setItemSharedWith(...)` updates the local IndexedDB row.
2. A debounced reconcile job runs `applySharedWithToDriveFiles(...)`.
3. Reconcile ensures:
   - every recipient in `sharedWith` has Drive reader access to the file
   - recipients are removed when no longer present
   - recipients can read `_infodepo_index.json` (so they can discover shared items)
4. On sync, owner index is re-written with the latest metadata.

## Receiver flow (discover and download)

Receivers discover shared content via peer folder indexes:

1. Read peer list from `config.json` (`users` with `folderId`).
2. For each peer folder, fetch `_infodepo_index.json`.
3. Keep index entries where `sharedWith` contains the receiver email.
4. Download those files by `driveId`.
5. Remove local peer-owned rows that are no longer present in that peer's `sharedWith` set.
6. Upsert still-shared rows into local IndexedDB with `ownerEmail` preserved.

This flow is implemented by `syncSharedFromPeers(...)`.

## Files involved

- `components/DataTile.js` - per-item/channel "Shared with" editor
- `components/Library.js` - sharing permissions, owner checks, reconcile scheduling
- `hooks/useIndexedDB.js` - `setItemSharedWith(...)`
- `utils/ownerIndex.js` - read/write `_infodepo_index.json`
- `utils/peerSync.js` - receiver discovery/download from peer indexes + prune revoked shares
- `utils/driveSharePermissions.js` - ACL reconcile from `sharedWith`
- `utils/userConfig.js` - user roles and `folderId` lookup (`config.json`)

## config.json shape

`config.json` must be in the new `users` map format:

```json
{
  "master": "master@example.com",
  "users": {
    "master@example.com": { "role": "master", "folderId": "..." },
    "editor@example.com": { "role": "editor", "folderId": "..." },
    "viewer@example.com": { "role": "viewer", "folderId": "..." }
  }
}
```

`folderId` is required for peer discovery.

## Notes and limitations

- If OAuth scope is too narrow, ACL/config writes can fail; re-consent with broader Drive scope is required.
- Sharing controls only appear when `config.json` is loaded and has eligible recipient users.
- Peer sync now prunes previously downloaded peer-owned rows when they are no longer shared in the owner's index.
- Pruning only runs when an owner index is successfully fetched and validated for that peer.
