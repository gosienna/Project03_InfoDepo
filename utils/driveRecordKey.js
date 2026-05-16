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
