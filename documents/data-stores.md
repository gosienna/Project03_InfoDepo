# Data stores

Current IndexedDB database: `InfoDepo`, schema version `7`.

## Stores

| Store | Purpose |
|------|---------|
| `books` | EPUB/PDF/TXT content |
| `notes` | Markdown notes (with optional inline `assets`) |
| `videos` | YouTube link records (`application/x-youtube`) |
| `images` | legacy note images (new notes prefer `note.assets`) |
| `channels` | YouTube channel records |
| `pdfAnnotations` | per-PDF annotation sidecar |

`shares` store was removed in v7.

## Common fields (content records)

For `books`/`notes`/`videos`/`images` (and channel-compatible subset):

```js
{
  id,
  name,
  data,
  type,
  size,
  driveId,
  modifiedTime,
  localModifiedAt,
  tags,
  sharedWith,   // string[]
  ownerEmail    // string
}
```

Additional fields:

- `notes`: `assets[]`, optional `driveFolderId`
- `images`: `noteId`
- `channels`: `channelId`, `handle`, `thumbnailUrl`, `videos[]`, etc.
- `pdfAnnotations`: `sidecarKey`, `pdfDriveId`, `annotationDriveId`, `annotations[]`, `version`

## Key indexes

- `driveId` index on `books`, `notes`, `videos`
- `noteId` index on `images`
- unique `channelId` index on `channels`

## UI-facing collections

`useIndexedDB` exposes:

- `items` = merged `books` + `notes` + `videos`
- `channels`

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

v7 changes:

- dropped `shares` object store
- added `sharedWith` and `ownerEmail` to content stores
- retained `pdfAnnotations`

For reset during development, use app "Clear All" or clear site storage in browser devtools.
