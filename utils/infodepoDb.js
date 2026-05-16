/**
 * Current schema (v10):
 *   books, notes, videos, channels, desks — keyPath `driveId` (temp local:… or Google file id)
 *   images — legacy note images (noteDriveId index)
 *   pdfAnnotations — sidecarKey = `${idbStore}:${pdfDriveId}`
 *
 * books/notes/videos use: { driveId, name, data, type, size, modifiedTime, sharedWith, ownerEmail, … }
 * channels: { driveId, channelId, … } — channelId unique index for YouTube dedup
 * desks: { driveId, name, layout: { "drive:{driveId}": { x, y } }, … }
 *
 * v10: driveId-only primary keys; removed numeric `id`.
 *
 * To reset: use "Clear All" in settings, or clear site data in DevTools → Application → Storage.
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 10;
