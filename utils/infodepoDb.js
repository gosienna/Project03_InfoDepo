/**
 * Current schema (v1):
 *   books    — EPUB, PDF, TXT  (driveId index)
 *   notes    — Markdown notes  (driveId index); notes carry inline assets: assets[]
 *   videos   — YouTube links   (driveId index)
 *   images   — legacy note images (noteId index; superseded by note.assets)
 *   channels — YouTube channel metadata + video list  (channelId index, unique)
 *   shares   — Drive share configs (string keyPath `id`, same shape as sharesDriveJson client record)
 *
 * books/notes/videos/images use: { id, name, data, driveId, type, size, modifiedTime }
 * notes add: assets[], driveFolderId
 * images add: noteId
 * channels use: { id, channelId, handle, name, thumbnailUrl, videos[], tags[], driveId, modifiedTime }
 *
 * `pdfAnnotations` — per-PDF annotation sidecar (keyPath sidecarKey = `${idbStore}:${itemId}`).
 * Not the PDF blob format: PDF bytes stay in `books`/`notes`; annotations are a separate store + optional Drive JSON sidecar.
 *
 * To reset: use "Clear All" in settings, or clear site data in DevTools → Application → Storage.
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 6;
