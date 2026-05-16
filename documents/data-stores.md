# Data stores

Current IndexedDB database: `InfoDepo`, schema version `10`.

## Stores

| Store | Purpose |
|------|---------|
| `books` | EPUB/PDF/TXT content and **standalone images** (`type.startsWith('image/')`) |
| `notes` | Markdown notes (with optional inline `assets`) |
| `videos` | YouTube link records (`application/x-youtube`) and web URL bookmarks (`application/x-url`) |
| `images` | legacy note images (new notes prefer `note.assets`) |
| `channels` | YouTube channel records |
| `desks` | Infinite-canvas layout records |
| `pdfAnnotations` | per-PDF annotation sidecar |

`shares` store was removed in v7.

## Primary key: `driveId`

All content stores (`books`, `notes`, `videos`, `channels`, `desks`) use **`driveId` as the IndexedDB keyPath** (no numeric `id`).

| Kind | `driveId` value |
|------|-----------------|
| **Google Drive file** | Opaque file id from Drive API (never starts with `local:`) |
| **Not uploaded yet** | Temp key `local:{store}:{uuid}` (e.g. `local:books:550e8400-e29b-…`) |

Helpers: [`utils/driveRecordKey.js`](../utils/driveRecordKey.js) — `isTempDriveId()`, `makeTempDriveId(store)`, `deskLayoutKey(driveId)`.

After upload, `promoteDriveId` (formerly “set drive id on row”) deletes the temp key and inserts the same record under the real Drive file id. Desk layout keys `drive:local:…` are remapped to `drive:{realId}` (eagerly on upload, lazily via `migrateDeskDataKeys` when a desk opens).

## Common fields (content records)

```js
{
  driveId,            // primary key (temp or Google)
  name,
  data,               // Blob | null
  type,
  size,
  modifiedTime,
  localModifiedAt,
  lastVisitedAt,
  tags,
  sharedWith,
  ownerEmail,
  coverImage,
  coverImageDriveId,
}
```

**Standalone images** (`type.startsWith('image/')`) live in `books`. The Library filter key `'images'` matches them independently of `'books'`.

Additional fields:

- `notes`: `assets[]`, optional `driveFolderId`
- `images` (legacy): `noteDriveId`
- `channels`: `channelId` (unique index), `handle`, `videos[]`, etc.
- `desks`: `layout`, `connections`, etc.

## Desk layout keys

Canonical format: **`drive:{driveId}`** — see [`utils/deskEntryKeys.js`](../utils/deskEntryKeys.js).

`resolveLayoutEntry` and `migrateDeskDataKeys` rewrite stale temp keys when items gain a real Drive id.

## Key indexes

- `channelId` unique index on `channels`
- `noteDriveId` index on legacy `images`
- `pdfAnnotations`: keyPath `sidecarKey` = `` `${idbStore}:${itemDriveId}` ``

## Readers

Standalone EPUB/PDF tabs use `?driveId=…&store=books` (no legacy `?id=`).

## Schema history

- **v10:** `driveId` keyPath on content stores; removed numeric `id`; desk layout migration to `drive:{driveId}`.
- **v9:** desks store repair.
- **v7:** dropped `shares`; added `sharedWith` / `ownerEmail`.

To reset: “Clear All” in settings or clear site data in DevTools.

## Storage quota and LRU eviction

Unchanged from prior versions — eviction nulls `data` but keeps metadata and `driveId`. See [`hooks/useIndexedDB.js`](../hooks/useIndexedDB.js) `evictLeastRecentlyVisited`.
