# Data stores

Current IndexedDB database: `InfoDepo`, schema version `11`.

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

## Two-field identity: `driveId` + `driveFileId`

All content stores (`books`, `notes`, `videos`, `channels`, `desks`, `images`) use **`driveId` as the IndexedDB keyPath** (no numeric `id`).

| Field | Role |
|-------|------|
| **`driveId`** | Permanent app-issued key, always `local:{store}:{uuid}` after v11. Never replaced on upload. |
| **`driveFileId`** | Google Drive file id when the row exists on Drive; absent = local-only. Indexed for sync lookup. |

Helpers: [`utils/driveRecordKey.js`](../utils/driveRecordKey.js) — `makeTempDriveId(store)`, `hasDriveCopy(record)`, `deskLayoutKey(driveId)`.

Upload/sync sets `driveFileId` in place via `setItemDriveId` (local `driveId` unchanged). The owner index still publishes Google ids as `driveId` in `_infodepo_index.json` for backward compatibility.

## Common fields (content records)

```js
{
  driveId,            // primary key (local:…)
  driveFileId,        // Google Drive file id (optional)
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

## Desk layout keys and values

Canonical layout key: **`drive:{localDriveId}`** — see [`utils/deskEntryKeys.js`](../utils/deskEntryKeys.js).

Layout values: `{ x, y, driveFileId? }`. The optional `driveFileId` enables cross-device desk resolution when layout JSON is pulled from Drive.

`normalizeDeskLayoutV11` runs on DB upgrade and at desk open to rewrite legacy key shapes (numeric ids, Google-id keys from v10) into the v11 format. `remapDeskLayoutByDriveFileId` resolves pending tiles by matching `value.driveFileId` to local rows.

## Key indexes

- `driveFileId` index on all content stores (v11)
- `channelId` unique index on `channels`
- `noteDriveId` index on legacy `images`
- `pdfAnnotations`: keyPath `sidecarKey` = `` `${idbStore}:${itemDriveId}` `` (uses local `driveId`)

## Readers

Standalone EPUB/PDF tabs use `?driveId=…&store=books` with the **local** `driveId`. Lazy download fetches blob via `driveFileId` when `data` is null.

## Schema history

- **v11:** stable local `driveId` + `driveFileId`; v10 Google-id primary keys migrated; desk layout normalization.
- **v10:** `driveId` keyPath on content stores; removed numeric `id`; desk layout migration to `drive:{driveId}`.
- **v9:** desks store repair.
- **v7:** dropped `shares`; added `sharedWith` / `ownerEmail`.

To reset: “Clear All” in settings or clear site data in DevTools.

## Storage quota and LRU eviction

Unchanged from prior versions — eviction nulls `data` but keeps metadata and `driveId`. See [`hooks/useIndexedDB.js`](../hooks/useIndexedDB.js) `evictLeastRecentlyVisited`.
