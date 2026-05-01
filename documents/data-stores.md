# Data stores

Current IndexedDB database: `InfoDepo`, schema version `8`.

## Stores

| Store | Purpose |
|------|---------|
| `books` | EPUB/PDF/TXT content |
| `notes` | Markdown notes (with optional inline `assets`) |
| `videos` | YouTube link records (`application/x-youtube`) |
| `images` | legacy note images (new notes prefer `note.assets`) |
| `channels` | YouTube channel records |
| `desks` | Infinite-canvas layout records |
| `pdfAnnotations` | per-PDF annotation sidecar |

`shares` store was removed in v7.

## Common fields (content records)

For `books`/`notes`/`videos`/`images` (and channel-compatible subset):

```js
{
  id,
  name,
  data,             // Blob | null (null when evicted by LRU quota enforcement)
  type,
  size,             // bytes; set to 0 after eviction
  driveId,
  modifiedTime,
  localModifiedAt,
  lastVisitedAt,    // Date | null — updated each time the item is opened in Reader
  tags,
  sharedWith,       // string[]
  ownerEmail        // string
}
```

`lastVisitedAt` is set to the current time when an item is first imported (`addItem`) and updated each time the user opens it. Items that have never been opened have `lastVisitedAt: null`, which sorts them as oldest for LRU eviction purposes.

Additional fields:

- `notes`: `assets[]`, optional `driveFolderId`
- `images`: `noteId`
- `channels`: `channelId`, `handle`, `thumbnailUrl`, `videos[]`, etc.
- `pdfAnnotations`: `sidecarKey`, `pdfDriveId`, `annotationDriveId`, `annotations[]`, `version`

## Desk record fields

```js
{
  id,                   // auto-increment integer
  name,                 // string
  layout,               // { [key]: { x, y } } — positions of items on the canvas
  tags,                 // string[]
  driveId,              // string | undefined — Drive file ID of backup .desk.json
  modifiedTime,         // string | undefined
  localModifiedAt,      // number | undefined
  sharedWith,           // string[]
  ownerEmail            // string
}
```

Layout key format: `"books:N"` | `"notes:N"` | `"videos:N"` | `"channel:N"` | `"desk:N"` where `N` is the IndexedDB record id.

## Key indexes

- `driveId` index on `books`, `notes`, `videos`, `desks`
- `noteId` index on `images`
- unique `channelId` index on `channels`

## UI-facing collections

`useIndexedDB` exposes:

- `items` = merged `books` + `notes` + `videos`
- `channels`
- `desks`

There is no `shares` collection anymore.

## Sharing-related persistence

Item-level sharing state is persisted directly on records:

- `sharedWith` controls who should have Drive reader access
- `ownerEmail` tracks ownership origin for peer sync and prune logic

Viewer prune helpers use these fields to remove revoked peer-owned items:

- `getLocalRecordsByOwnerEmail`
- `deleteItemByDriveId`
- `deleteChannelByDriveId`

## Schema history note

v8 changes:

- added `desks` object store with `driveId` index

v7 changes:

- dropped `shares` object store
- added `sharedWith` and `ownerEmail` to content stores
- retained `pdfAnnotations`

For reset during development, use app "Clear All" or clear site storage in browser devtools.

## Storage quota and LRU eviction

A configurable storage limit (default **500 GB**, stored in `localStorage` under `infodepo_sync_settings`) is enforced automatically. The limit is managed via `utils/syncSettings.js`:

```js
getSyncSettings()  // → { maxStorageGB: number }
saveSyncSettings({ maxStorageGB })
```

**When eviction runs:**
- Once on startup after `dataReady` becomes true.
- After each new item is imported via `addItem`.

**Eviction algorithm (`evictLeastRecentlyVisited` in `useIndexedDB.js`):**
1. Sum `size` across `books`, `notes`, and `videos`.
2. If total ≤ limit, stop.
3. Collect candidates from `books` and `notes` where `size > 1024` (1 KB) and `data != null`.
4. Sort by `lastVisitedAt` ascending (`null` = epoch = evicted first).
5. Null out `data` and set `size = 0` one record at a time until total drops below the limit.
6. Call `loadAll()` to refresh the UI.

Evicted items remain visible in the library grid (metadata preserved) but cannot be opened — their blob data has been cleared. Re-syncing from Drive restores the content.

**User-facing controls:** System Settings → **Storage** section shows a progress bar and allows adjusting the GB limit.
