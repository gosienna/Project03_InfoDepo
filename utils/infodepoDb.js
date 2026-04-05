/**
 * Current schema (v2):
 *   books    — EPUB, PDF, TXT  (driveId index)
 *   notes    — Markdown notes  (driveId index)
 *   videos   — YouTube links   (driveId index)
 *   images   — note images     (noteId index)
 *   channels — YouTube channel metadata + video list  (channelId index, unique)
 *   shares   — Drive share configs (string keyPath `id`, same shape as sharesDriveJson client record)
 *
 * books/notes/videos/images use: { id, name, data, driveId, type, size, modifiedTime }
 * images adds: noteId
 * channels uses: { id, channelId, handle, name, thumbnailUrl, videos[], tags[], driveId, modifiedTime }
 *
 * To reset: clear site data (DevTools → Application → Storage → Clear site data).
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 2;
