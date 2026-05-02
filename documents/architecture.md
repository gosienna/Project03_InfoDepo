# Architecture

## Overview

InfoDepo is a browser-only app (no backend database). Content is stored in IndexedDB and optionally synchronized with Google Drive.

```
User
 └── Browser
      ├── React app (Vite) — index.html
      │    ├── Library (items/channels/desks, sync, sharing)
      │    ├── Desk (infinite canvas for item layout)
      │    ├── Reader (PDF/TXT/MD/YouTube — inline)
      │    └── Explorer (web page → markdown note)
      ├── EPUB reader tab — reader.html   ← new tab, opened for EPUB/MOBI/AZW
      └── IndexedDB (InfoDepo, v9)        ← shared by both tabs
```

## Current component map

```
App.js
├── GoogleLoginGate.js      # step 1: Google sign-in (all users when credentials exist)
├── DriveFolderGate.js      # step 2: owner/editor folder setup (viewer skips)
├── Header.js               # top bar, user email + role badge, system settings (editor+), manage users (master)
│   └── UserConfigModal.js  # edits config.json users map
├── NewNoteModal.js         # owned by App; shared by Library and Desk
├── NewYoutubeModal.js      # owned by App; shared by Library and Desk
├── NewChannelModal.js      # owned by App; shared by Library and Desk
├── Library.js              # grid, sync, upload, item-level sharedWith, peer sync for viewer, system settings modal
│   ├── AddContentDropdown.js  # reusable dropdown: new note / YouTube / channel / file / desk
│   ├── DataTile.js         # item/channel cards with tags + sharedWith editor
│   ├── DeskTile.js         # library-grid tile for desk records
│   └── DeleteContentModal.js
├── Desk.js                 # infinite canvas with pan/zoom, drag, dot-grid background
│   ├── AddContentDropdown.js  # same component reused here
│   └── DeskTile.js
├── YoutubeChannelViewer.js
├── Reader.js              ← PDF / TXT / MD / YouTube (inline)
│   ├── PdfViewer.js
│   ├── TxtViewer.js
│   ├── MarkdownEditor.js
│   ├── YoutubeViewer.js
│   └── UnsupportedViewer.js
└── (reader.html / reader-entry.js)  ← separate tab for EPUB/MOBI/AZW
    └── FoliateViewer.js   ← foliate-js wrapper (used only in reader tab)
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

### Desk mode

Users create named desks that hold a `layout` map of item positions (`{ [key]: { x, y } }`). Each desk is backed up to Drive as `<name>.desk.json`. Items, channels, and other desks can be placed on the canvas. Layout changes are committed to IndexedDB on drag-end and synced to Drive on the next owner pipeline run.

**Desk title / selector** (`DeskSelector`, top-center): always shows the current desk name as a large bold title. When more than one desk exists, a chevron renders and clicking opens a dropdown listing all desks. Each row has a pencil icon for inline rename (Enter/Escape/blur to save/cancel). Switching desks calls `onSelectDesk` → `handleSelectDesk` in App, which updates `lastVisitedAt` via `touchItemVisit`. On startup the most recently visited desk is selected automatically.

**Top-right toolbar** (editor/master only) provides two ways to add content:
- **InlineAddSearch** — type filter tabs (All / Books / Notes / Videos / Images / Channels / Desks) at the top of the dropdown narrow results by store type. Text search matches item names and tag values. Typing a partial tag name surfaces matching tags as clickable suggestion pills; active tag filters stack as removable indigo pills. Click a result to place it at the viewport center.
- **AddContentDropdown** — creates new content (note, YouTube, channel, file); newly created items are automatically placed on the current desk via `addToDeskIfActive` in `App.js`.

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
| `App.js` | startup gates, role resolution, main routing, visit tracking, eviction trigger, add-content modal state, `addToDeskIfActive` |
| `hooks/useIndexedDB.js` | IndexedDB CRUD, sync helpers, storage quota (`touchItemVisit`, `getTotalStorageUsed`, `evictLeastRecentlyVisited`, `checkAndEvict`) |
| `components/Library.js` | sync UI, tile actions, share ACL/update orchestration, storage settings UI, system settings modal |
| `components/AddContentDropdown.js` | reusable "+ Add Content" dropdown used in Library and Desk |
| `utils/syncSettings.js` | storage limit persistence (`maxStorageGB`, default 500) |
| `utils/driveSync.js` | backup + folder pull engine |
| `utils/libraryDriveSync.js` | owner sync orchestration |
| `utils/ownerIndex.js` | read/write `_infodepo_index.json` |
| `utils/peerSync.js` | peer discovery + viewer download/prune |
| `utils/driveSharePermissions.js` | apply/revoke Drive reader permissions |
| `utils/userConfig.js` | parse config users map and role/folder helpers |
| `components/Desk.js` | infinite-canvas component (pan/zoom, drag, add/remove items) |
| `components/DeskTile.js` | library grid tile for desk records |

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
