/**
 * Current schema (v11):
 *   books, notes, videos, channels, desks — keyPath `driveId` (permanent local:… app key)
 *   driveFileId — Google Drive file id (secondary; indexed for sync lookup)
 *   images — legacy note images (noteDriveId index)
 *   pdfAnnotations — sidecarKey = `${idbStore}:${pdfDriveId}`
 *
 * books/notes/videos use: { driveId, name, data, type, size, modifiedTime, sharedWith, ownerEmail, … }
 * channels: { driveId, channelId, … } — channelId unique index for YouTube dedup
 * desks: { driveId, driveFileId?, name, layout: { "drive:{driveId}": { x, y, driveFileId? } }, … }
 *
 * v11: stable local driveId + driveFileId for Google Drive; v10 promoted Google ids migrated on upgrade.
 *
 * To reset: use "Clear All" in settings, or clear site data in DevTools → Application → Storage.
 */
export const INFO_DEPO_DB_NAME = 'InfoDepo';
export const INFO_DEPO_DB_VERSION = 11;
