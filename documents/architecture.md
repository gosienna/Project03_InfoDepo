# Architecture

## Overview

InfoDepo is a browser-only app (no backend database). Content is stored in IndexedDB and optionally synchronized with Google Drive.

```
User
 └── Browser
      ├── React app (Vite)
      │    ├── Library (items/channels, sync, sharing)
      │    ├── Reader (PDF/TXT/MD/YouTube)
      │    └── Explorer (web page → markdown note)
      ├── reader.html (EPUB in new tab)
      └── IndexedDB (InfoDepo, v7)
```

## Current component map

```
App.js
├── GoogleLoginGate.js      # step 1: Google sign-in (all users when credentials exist)
├── DriveFolderGate.js      # step 2: owner/editor folder setup (viewer skips)
├── Header.js               # top bar, user email + role badge, manage users (master)
│   └── UserConfigModal.js  # edits config.json users map
├── Library.js              # grid, sync, upload, item-level sharedWith, peer sync for viewer
│   ├── DataTile.js         # item/channel cards with tags + sharedWith editor
│   ├── NewNoteModal.js
│   ├── NewYoutubeModal.js
│   ├── NewChannelModal.js
│   └── DeleteContentModal.js
├── YoutubeChannelViewer.js
└── Reader.js
    ├── PdfViewer.js
    ├── TxtViewer.js
    ├── MarkdownEditor.js
    ├── YoutubeViewer.js
    └── UnsupportedViewer.js
```

## Sharing model (current)

Legacy share-link flow was removed. Sharing is now item-level:

- each record stores `sharedWith: string[]`
- each record stores `ownerEmail: string`
- owner writes `_infodepo_index.json` as discovery index
- Drive ACLs are reconciled from `sharedWith`
- viewers run peer sync from configured peer folders and prune revoked items

See [sharing-mechanism.md](sharing-mechanism.md).

## Core runtime flows

### Startup and role resolution

1. IndexedDB initializes via `useIndexedDB`.
2. If `VITE_CLIENT_ID` exists and token is missing, show `GoogleLoginGate`.
3. Resolve role:
   - `googleUserEmail === VITE_MASTER` -> `master`
   - otherwise resolve from `config.json` (`users` map)
4. `DriveFolderGate` runs only for `master`/`editor`.
5. `viewer` runs peer shared-content sync on load.

### Owner/editor sync

`runOwnerSyncPipeline`:
1. backup local updates to Drive
2. pull Drive folder updates to local
3. write owner index (`_infodepo_index.json`)
4. sync shared content from peers (if configured)

### Viewer sync

`syncSharedFromPeers`:
1. load peer list from `config.json` (`users` with `folderId`)
2. fetch each peer `_infodepo_index.json`
3. keep entries shared with current user
4. prune locally cached peer-owned rows not in current shared set
5. upsert remaining downloadable items/channels

## Storage quota

A 500 GB default quota is enforced client-side via LRU eviction. When total `size` across `books`/`notes`/`videos` exceeds the limit, `evictLeastRecentlyVisited` nulls the `data` blob of the least-recently-opened items (≥ 1 KB) until under the limit. Visit time is tracked via `lastVisitedAt` on each record, updated by `touchItemVisit` in `App.js` whenever an item is opened.

The limit is persisted in `localStorage` (`infodepo_sync_settings`) and is adjustable in System Settings → **Storage**. See [data-stores.md](data-stores.md) for full eviction details.

## Key files

| File | Purpose |
|------|---------|
| `App.js` | startup gates, role resolution, main routing, visit tracking, eviction trigger |
| `hooks/useIndexedDB.js` | IndexedDB CRUD, sync helpers, storage quota (`touchItemVisit`, `getTotalStorageUsed`, `evictLeastRecentlyVisited`, `checkAndEvict`) |
| `components/Library.js` | sync UI, tile actions, share ACL/update orchestration, storage settings UI |
| `utils/syncSettings.js` | storage limit persistence (`maxStorageGB`, default 500) |
| `utils/driveSync.js` | backup + folder pull engine |
| `utils/libraryDriveSync.js` | owner sync orchestration |
| `utils/ownerIndex.js` | read/write `_infodepo_index.json` |
| `utils/peerSync.js` | peer discovery + viewer download/prune |
| `utils/driveSharePermissions.js` | apply/revoke Drive reader permissions |
| `utils/userConfig.js` | parse config users map and role/folder helpers |

## Current config.json shape

```json
{
  "master": "master@example.com",
  "users": {
    "master@example.com": { "role": "master", "folderId": "..." },
    "editor@example.com": { "role": "editor", "folderId": "..." },
    "viewer@example.com": { "role": "viewer" }
  }
}
```

`viewer` rows do not require `folderId`; owner/editor rows should include it for peer sync.
