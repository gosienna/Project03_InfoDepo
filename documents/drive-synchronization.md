# Drive synchronization

InfoDepo syncs library content with a single **Google Drive folder** (owner mode) or downloads **individual files by Drive file ID** (receiver / linked shares). There is no server: the browser calls the Drive API with OAuth tokens.

## Code map

| File | Role |
|------|------|
| [`utils/libraryDriveSync.js`](../utils/libraryDriveSync.js) | **`runOwnerSyncPipeline`** — runs backup then folder pull. **`syncReceiverShareContent`** — forwards to per-ID download. |
| [`utils/driveSync.js`](../utils/driveSync.js) | **`backupAllToGDrive`** (upload / PATCH), **`syncDriveToLocal`** (list folder → download), **`syncSharedFilesByDriveId`** (receiver fetch by id). Exports **`CHANNEL_JSON_MARKER`** for channel JSON on Drive. |
| [`components/Library.js`](../components/Library.js) | UI, token acquisition, calls `runOwnerSyncPipeline`, manual/per-tile uploads, share flows, **background sync on load** (once per page load). |
| [`hooks/useIndexedDB.js`](../hooks/useIndexedDB.js) | **`localModifiedAt`** / **`modifiedTime`**, **`setItemDriveId`** (optional Drive `modifiedTime` after upload). |

## Owner: two phases

1. **Backup (upload)** — `backupAllToGDrive`  
   - **New** files: multipart upload into the linked folder (or a subfolder for Markdown notes with embedded images).  
   - **Updates**: multipart **PATCH** to an existing Drive file id when the local record is “dirty” (see below).  
   - After each successful create/upload, IndexedDB stores **`modifiedTime`** and **`localModifiedAt`** from Drive’s **`modifiedTime`** so local and remote revisions align.

2. **Pull (download)** — `syncDriveToLocal`  
   - Lists the folder, downloads supported MIME types and note bundles, resolves share JSON by filename, and upserts into IndexedDB.  
   - Skips a file when the Drive **`modifiedTime`** is not newer than the stored **`modifiedTime`** (conflict resolution favors the remote when newer).

Orchestration for the **Sync** button and background run is **`runOwnerSyncPipeline`** in [`libraryDriveSync.js`](../utils/libraryDriveSync.js): backup first, then pull.

## Local edits vs Drive revision (`localModifiedAt` / `modifiedTime`)

- **`modifiedTime`** — Last known **Google Drive** `modifiedTime` for that file (after a successful upload or download). Used when deciding whether **pull** should overwrite local data.
- **`localModifiedAt`** — Last **local** mutation (create, edit, tag change, note image change, channel edit). It is **not** advanced on pull-only upserts in a way that would mask Drive’s version; after a successful upload or download of that record, both fields are aligned to the Drive timestamp.

**Backup upload runs** when:

- There is **no** `driveId`, or  
- **`localModifiedAt` is newer than `modifiedTime`** (and `localModifiedAt` is present for comparison).

Legacy rows without `localModifiedAt` but with a `driveId` are treated as not locally dirty until they receive a local edit that sets `localModifiedAt`.

## Background sync on startup

When the library is shown and Drive credentials plus a folder id are configured, **`Library`** schedules **one** owner pipeline run (`setTimeout` 0) per page load. A module-level flag prevents a second schedule on React Strict Mode remount. The same **`syncInFlightRef`** used by manual Sync avoids overlapping runs.

If OAuth fails (no token), the run errors and the usual token cleanup applies; there is no separate polling loop.

## Receiver / linked shares

Receivers do **not** use the folder listing for the owner’s tree. They fetch the share JSON by file id, then **`syncSharedFilesByDriveId`** loads each referenced **`driveId`** (metadata + `alt=media`). See [`components.md`](components.md) share flows and [`google-drive-integration.md`](google-drive-integration.md) for ACLs.

## Shares (owner)

- Share configs are serialized to `*.share.json` in the folder via [`utils/sharesDriveFile.js`](../utils/sharesDriveFile.js).  
- **Drive reader ACLs** for recipients are reconciled in [`utils/driveSharePermissions.js`](../utils/driveSharePermissions.js).  
- This is separate from the main **backup** loop, except that tag-driven debounced jobs may re-upload share JSON and re-apply ACLs.

## Related docs

- [Google Drive integration](google-drive-integration.md) — OAuth, scopes, folder.  
- [Data stores](data-stores.md) — IndexedDB stores and fields.  
- [Architecture](architecture.md) — End-to-end data flow.
