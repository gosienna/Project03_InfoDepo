/**
 * Current schema (v9):
 *   books    — EPUB, PDF, TXT  (driveId index)
 *   notes    — Markdown notes  (driveId index); notes carry inline assets: assets[]
 *   videos   — YouTube links   (driveId index)
 *   images   — legacy note images (noteId index; superseded by note.assets)
 *   channels — YouTube channel metadata + video list  (channelId index, unique)
 *   desks    — Infinite canvas workspaces (driveId index)
 *
 * books/notes/videos/images use: { id, name, data, driveId, type, size, modifiedTime, sharedWith, ownerEmail }
 * notes add: assets[], driveFolderId
 * images add: noteId
 * channels use: { id, channelId, handle, name, thumbnailUrl, videos[], tags[], driveId, modifiedTime, sharedWith, ownerEmail }
 * desks use: { id, name, layout: { [key]: { x, y } }, connections?: [{ id, fromKey, toKey, route }], tags[], driveId, modifiedTime, localModifiedAt, sharedWith, ownerEmail }
 *   layout keys: prefer "drive:{driveId}"; local-only items use "local:{books|notes|videos}:N" or "local:channel:N"; nested desks without Drive use "desk:N" (legacy "store:N" / "channel:N" still load)
 *
 * `pdfAnnotations` — per-PDF annotation sidecar (keyPath sidecarKey = `${idbStore}:${itemId}`).
 *
 * v7: added sharedWith (string[]) and ownerEmail (string) to all content stores; dropped `shares` store.
 * v8: added desks store for infinite canvas workspaces.
 * v9: re-run upgrade so DBs that reached v8 before the desks migration get the `desks` object store.
 *
 * To reset: use "Clear All" in settings, or clear site data in DevTools → Application → Storage.
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 9;
