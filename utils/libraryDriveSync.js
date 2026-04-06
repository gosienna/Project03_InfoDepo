/**
 * Orchestrates Google Drive sync for the library UI: owner backup + folder pull, receiver share downloads.
 */

import { syncDriveToLocal, backupAllToGDrive, syncSharedFilesByDriveId } from './driveSync.js';

/**
 * Owner: upload pending/dirty local content, then pull from the linked Drive folder into IndexedDB.
 * @returns {Promise<{ backed: number, backupFailed: number, added: number, updated: number, skipped: number }>}
 */
export async function runOwnerSyncPipeline({
  accessToken,
  folderId,
  items,
  channels,
  onSetDriveId,
  onSetNoteFolderData,
  onProgress,
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  getShareByDriveFileId,
  upsertDriveShare,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  getNotes,
  upsertDriveChannel,
}) {
  const backupResult = await backupAllToGDrive({
    accessToken,
    folderId,
    items,
    channels,
    onSetDriveId,
    onSetNoteFolderData,
    onProgress,
  });

  const syncResult = await syncDriveToLocal({
    accessToken,
    folderId,
    books: (items || []).filter((i) => i.type !== 'application/x-youtube'),
    getBookByDriveId,
    getBookByName,
    upsertDriveBook,
    getShareByDriveFileId,
    upsertDriveShare,
    getImageByDriveId,
    getImageByName,
    upsertDriveImage,
    getNotes,
    upsertDriveChannel,
    onProgress,
  });

  return {
    backed: backupResult.backed,
    backupFailed: backupResult.failed,
    added: syncResult.added,
    updated: syncResult.updated,
    skipped: syncResult.skipped,
  };
}

/** Receiver: download shared files by Drive file id (metadata + media). */
export function syncReceiverShareContent(params) {
  return syncSharedFilesByDriveId(params);
}
