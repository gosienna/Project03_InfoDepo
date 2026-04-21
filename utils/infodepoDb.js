/**
 * Current schema (v7):
 *   books    — EPUB, PDF, TXT  (driveId index)
 *   notes    — Markdown notes  (driveId index); notes carry inline assets: assets[]
 *   videos   — YouTube links   (driveId index)
 *   images   — legacy note images (noteId index; superseded by note.assets)
 *   channels — YouTube channel metadata + video list  (channelId index, unique)
 *
 * books/notes/videos/images use: { id, name, data, driveId, type, size, modifiedTime, sharedWith, ownerEmail }
 * notes add: assets[], driveFolderId
 * images add: noteId
 * channels use: { id, channelId, handle, name, thumbnailUrl, videos[], tags[], driveId, modifiedTime, sharedWith, ownerEmail }
 *
 * `pdfAnnotations` — per-PDF annotation sidecar (keyPath sidecarKey = `${idbStore}:${itemId}`).
 *
 * v7: added sharedWith (string[]) and ownerEmail (string) to all content stores; dropped `shares` store.
 *
 * To reset: use "Clear All" in settings, or clear site data in DevTools → Application → Storage.
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 7;
