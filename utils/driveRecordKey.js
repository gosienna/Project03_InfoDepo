/**
 * driveId values: Google Drive file IDs (opaque) or app-issued temp keys (local:…).
 * Temp keys never collide with Drive IDs — Google never issues IDs starting with "local:".
 */

export const TEMP_PREFIX = 'local:';

/** True for app-issued keys; false for Google Drive file IDs. */
export function isTempDriveId(d) {
  return String(d || '').trim().startsWith(TEMP_PREFIX);
}

/** New imports: local:books:<uuid> */
export function makeTempDriveId(store) {
  return `local:${store}:${crypto.randomUUID()}`;
}

/** v9→v10 migration only: local:books:5 preserves desk links from old numeric id */
export function migrationTempDriveId(store, oldNumericId) {
  return `local:${store}:${oldNumericId}`;
}

/** Desk canvas / connection key: drive:{driveId} */
export function deskLayoutKey(driveId) {
  return `drive:${String(driveId || '').trim()}`;
}

/** Parse drive: layout key → raw driveId (temp or real). */
export function parseDeskLayoutKey(key) {
  return key?.startsWith('drive:') ? key.slice(6).trim() : '';
}

/** True when the record has been uploaded or synced to Google Drive. */
export function hasDriveCopy(record) {
  return Boolean(String(record?.driveFileId || '').trim());
}

/**
 * Drive sync state for display: 'local' (never uploaded), 'pending' (local edits
 * newer than the last known Drive revision), or 'synced'. Mirrors the newer-check
 * used by itemNeedsBackupUpload in utils/driveSync.js, but doesn't require a loaded blob.
 */
export function getDriveSyncStatus(record) {
  if (!hasDriveCopy(record)) return 'local';
  const lm = record?.localModifiedAt != null ? new Date(record.localModifiedAt).getTime() : NaN;
  const mt = record?.modifiedTime != null ? new Date(record.modifiedTime).getTime() : NaN;
  if (!Number.isNaN(lm) && !Number.isNaN(mt) && lm > mt) return 'pending';
  return 'synced';
}
