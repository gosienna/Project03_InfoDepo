/**
 * Current schema (v1):
 *   books   — EPUB, PDF, TXT  (driveId index)
 *   notes   — Markdown notes  (driveId index)
 *   videos  — YouTube links   (driveId index)
 *   images  — note images     (noteId index)
 *
 * All stores use: { id, name, data, driveId, type, size, modifiedTime }
 * images adds: noteId
 *
 * To reset: clear site data (DevTools → Application → Storage → Clear site data).
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 1;
