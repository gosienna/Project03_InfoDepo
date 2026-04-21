/**
 * Orchestrates Google Drive sync for the library UI: owner backup + folder pull + peer shared content.
 */

import { syncDriveToLocal, backupAllToGDrive } from './driveSync.js';
import { writeOwnerIndex } from './ownerIndex.js';
import { syncSharedFromPeers } from './peerSync.js';

/**
 * Owner: upload pending/dirty local content, then pull from the linked Drive folder into IndexedDB,
 * then write the owner index and sync shared content from peers.
 * @returns {Promise<{ backed: number, backupFailed: number, added: number, updated: number, skipped: number, removed: number, peerAdded: number, peerRemoved: number, peerFailed: number }>}
 */
export async function runOwnerSyncPipeline({
  accessToken,
  folderId,
  items,
  channels,
  ownerEmail,
  config,
  onSetDriveId,
  onSetNoteFolderData,
  onProgress,
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  getNotes,
  getChannelByDriveId,
  upsertDriveChannel,
  getLocalRecordsByOwnerEmail,
  deleteItemByDriveId,
  deleteChannelByDriveId,
  getPdfAnnotationSidecar,
  setPdfAnnotationDriveSync,
  upsertDrivePdfAnnotation,
}) {
  const backupResult = await backupAllToGDrive({
    accessToken,
    folderId,
    items,
    channels,
    onSetDriveId,
    onSetNoteFolderData,
    onProgress,
    getPdfAnnotationSidecar,
    setPdfAnnotationDriveSync,
  });

  const syncResult = await syncDriveToLocal({
    accessToken,
    folderId,
    books: (items || []).filter((i) => i.type !== 'application/x-youtube'),
    getBookByDriveId,
    getBookByName,
    upsertDriveBook,
    getImageByDriveId,
    getImageByName,
    upsertDriveImage,
    getNotes,
    getChannelByDriveId,
    upsertDriveChannel,
    upsertDrivePdfAnnotation,
    onProgress,
  });

  try {
    onProgress?.('Writing owner index…');
    await writeOwnerIndex({ accessToken, folderId, ownerEmail, items, channels });
  } catch (err) {
    console.warn('[libraryDriveSync] writeOwnerIndex failed:', err);
  }

  let peerResult = { added: 0, failed: 0 };
  if (config) {
    try {
      peerResult = await syncSharedFromPeers({
        accessToken,
        myEmail: ownerEmail,
        config,
        getBookByDriveId,
        upsertDriveBook,
        getChannelByDriveId,
        upsertDriveChannel,
        getLocalRecordsByOwnerEmail,
        deleteItemByDriveId,
        deleteChannelByDriveId,
        onProgress,
      });
    } catch (err) {
      console.warn('[libraryDriveSync] peer sync failed:', err);
    }
  }

  return {
    backed: backupResult.backed,
    backupFailed: backupResult.failed,
    added: syncResult.added + peerResult.added,
    updated: syncResult.updated,
    skipped: syncResult.skipped,
    removed: peerResult.removed || 0,
    peerAdded: peerResult.added,
    peerRemoved: peerResult.removed || 0,
    peerFailed: peerResult.failed,
  };
}
