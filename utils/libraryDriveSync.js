/**
 * Orchestrates Google Drive sync for the library UI: owner backup + folder pull + peer shared content.
 */

import { syncDriveToLocal, backupAllToGDrive } from './driveSync.js';
import { writeOwnerIndex, fetchOwnerIndex } from './ownerIndex.js';
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
  desks,
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
  getDeskByDriveId,
  upsertDriveDesk,
  getLocalRecordsByOwnerEmail,
  deleteItemByDriveId,
  deleteChannelByDriveId,
  getPdfAnnotationSidecar,
  setPdfAnnotationDriveSync,
  upsertDrivePdfAnnotation,
  setCoverImageDriveSync,
  upsertDriveCoverImage,
  mergeItemSharedWithByDriveId,
  mergeChannelSharedWithByDriveId,
  mergeDeskSharedWithByDriveId,
  deleteDeskByDriveId,
}) {
  // Step 1: fetch the current Drive index and merge any sharedWith differences into
  // local IDB. This reconciles divergence when two browser sessions edit sharing
  // independently. Drive index is authoritative; items not yet in the index are skipped.
  let syncItems = items;
  let syncChannels = channels;
  let syncDesks = desks;
  try {
    onProgress?.('Merging sharedWith from Drive index…');
    const driveIndex = await fetchOwnerIndex({ accessToken, folderId, expectedOwnerEmail: ownerEmail });
    if (driveIndex && Array.isArray(driveIndex.items)) {
      const normalizeList = (arr) =>
        (Array.isArray(arr) ? arr : []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean).sort();

      const itemByDriveId = new Map(
        (items || []).filter((i) => i.driveId).map((i) => [String(i.driveId).trim(), i])
      );
      const channelByDriveId = new Map(
        (channels || []).filter((c) => c.driveId).map((c) => [String(c.driveId).trim(), c])
      );
      const deskByDriveId = new Map(
        (desks || []).filter((d) => d.driveId).map((d) => [String(d.driveId).trim(), d])
      );

      const patchedItems = new Map();
      const patchedChannels = new Map();
      const patchedDesks = new Map();

      for (const entry of driveIndex.items) {
        const driveId = String(entry.driveId || '').trim();
        if (!driveId || !Array.isArray(entry.sharedWith)) continue;
        const driveSharedWith = normalizeList(entry.sharedWith);

        if (entry.type === 'infodepo-channel') {
          const local = channelByDriveId.get(driveId);
          if (!local) continue;
          if (normalizeList(local.sharedWith).join(',') === driveSharedWith.join(',')) continue;
          if (mergeChannelSharedWithByDriveId) await mergeChannelSharedWithByDriveId(driveId, entry.sharedWith);
          patchedChannels.set(driveId, driveSharedWith);
        } else if (entry.type === 'infodepo-desk') {
          const local = deskByDriveId.get(driveId);
          if (!local) continue;
          if (normalizeList(local.sharedWith).join(',') === driveSharedWith.join(',')) continue;
          if (mergeDeskSharedWithByDriveId) await mergeDeskSharedWithByDriveId(driveId, entry.sharedWith);
          patchedDesks.set(driveId, driveSharedWith);
        } else {
          const local = itemByDriveId.get(driveId);
          if (!local) continue;
          if (normalizeList(local.sharedWith).join(',') === driveSharedWith.join(',')) continue;
          if (mergeItemSharedWithByDriveId) await mergeItemSharedWithByDriveId(driveId, entry.sharedWith);
          patchedItems.set(driveId, driveSharedWith);
        }
      }

      if (patchedItems.size > 0) {
        syncItems = (items || []).map((item) => {
          const did = String(item.driveId || '').trim();
          return patchedItems.has(did) ? { ...item, sharedWith: patchedItems.get(did) } : item;
        });
      }
      if (patchedChannels.size > 0) {
        syncChannels = (channels || []).map((ch) => {
          const did = String(ch.driveId || '').trim();
          return patchedChannels.has(did) ? { ...ch, sharedWith: patchedChannels.get(did) } : ch;
        });
      }
      if (patchedDesks.size > 0) {
        syncDesks = (desks || []).map((dk) => {
          const did = String(dk.driveId || '').trim();
          return patchedDesks.has(did) ? { ...dk, sharedWith: patchedDesks.get(did) } : dk;
        });
      }
    }
  } catch (err) {
    console.warn('[libraryDriveSync] mergeOwnerIndex failed:', err);
  }

  // Step 2: write the owner index with the merged sharedWith state.
  try {
    onProgress?.('Writing owner index…');
    await writeOwnerIndex({ accessToken, folderId, ownerEmail, items: syncItems, channels: syncChannels, desks: syncDesks });
  } catch (err) {
    console.warn('[libraryDriveSync] writeOwnerIndex failed:', err);
  }

  const backupResult = await backupAllToGDrive({
    accessToken,
    folderId,
    items: syncItems,
    channels: syncChannels,
    desks,
    onSetDriveId,
    onSetNoteFolderData,
    onProgress,
    getPdfAnnotationSidecar,
    setPdfAnnotationDriveSync,
    onSetCoverImageDriveSync: setCoverImageDriveSync,
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
    getDeskByDriveId,
    upsertDriveDesk,
    upsertDrivePdfAnnotation,
    upsertDriveCoverImage,
    onProgress,
    lazyBooks: true,
  });

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
        getDeskByDriveId,
        upsertDriveDesk,
        getLocalRecordsByOwnerEmail,
        deleteItemByDriveId,
        deleteChannelByDriveId,
        deleteDeskByDriveId,
        onProgress,
        lazyBooks: true,
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
