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
  onBatchComplete,
}) {
  // Step 1: fetch the current Drive index and merge any sharedWith differences into
  // local IDB. This reconciles divergence when two browser sessions edit sharing
  // independently. Drive index is authoritative; items not yet in the index are skipped.
  let syncItems = items;
  let syncChannels = channels;
  let syncDesks = desks;
  // indexMetaByDriveId survives outside the try block so syncDriveToLocal can use it to
  // restore sharedWith + tags for items that are first downloaded in step 4.
  const indexMetaByDriveId = new Map();
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

      // Populate the meta map for ALL index entries so that items first downloaded in
      // step 4 (syncDriveToLocal) receive the correct sharedWith and tags instead of [].
      for (const entry of driveIndex.items) {
        const did = String(entry.driveId || '').trim();
        if (!did) continue;
        indexMetaByDriveId.set(did, {
          sharedWith: Array.isArray(entry.sharedWith) ? entry.sharedWith : [],
          tags: Array.isArray(entry.tags) ? entry.tags : [],
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

  // Merge index meta (sharedWith + tags) into book driveFile objects so that items
  // first downloaded here receive the correct values rather than [] defaults.
  const withIndexMeta = (f) => {
    const m = indexMetaByDriveId.get(String(f?.driveId || '').trim());
    return m ? { ...f, ...m } : f;
  };

  const syncResult = await syncDriveToLocal({
    accessToken,
    folderId,
    books: (items || []).filter((i) => i.type !== 'application/x-youtube'),
    getBookByDriveId,
    getBookByName,
    upsertDriveBook: (driveFile, blob, assets) => upsertDriveBook(withIndexMeta(driveFile), blob, assets),
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
    onBatchComplete,
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

/**
 * Viewer: backup locally-modified desks to the viewer's own Drive folder, then pull
 * desk files back down. All other content types are left untouched.
 */
export async function runViewerDeskSyncPipeline({
  accessToken,
  folderId,
  desks,
  onSetDriveId,
  onProgress,
  getBookByDriveId,
  getBookByName,
  getDeskByDriveId,
  upsertDriveDesk,
  onBatchComplete,
}) {
  const noop = async () => 'skipped';

  const backupResult = await backupAllToGDrive({
    accessToken,
    folderId,
    items: [],
    channels: [],
    desks,
    onSetDriveId,
    onProgress,
  });

  // syncDriveToLocal requires getBookByDriveId/getBookByName for its routing logic.
  // upsertDriveBook is a no-op: the viewer's folder contains only desk JSON files.
  const syncResult = await syncDriveToLocal({
    accessToken,
    folderId,
    getBookByDriveId: getBookByDriveId || noop,
    getBookByName:    getBookByName    || noop,
    upsertDriveBook:  noop,
    getDeskByDriveId,
    upsertDriveDesk,
    onProgress,
    onBatchComplete,
  });

  return {
    backed:       backupResult.backed,
    backupFailed: backupResult.failed,
    added:        syncResult.added,
    updated:      syncResult.updated,
    skipped:      syncResult.skipped,
  };
}
