/**
 * Orchestrates Google Drive sync for the library UI: owner backup + folder pull + peer shared content.
 */

import {
  classifyChanges,
  backupChangedItems,
  pullChangedItems,
  syncFolderAssetsAndSidecars,
} from './driveSync.js';
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
  getAnnotationByDriveId,
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
  let driveIndex = null;
  const patchedItems    = new Map();
  const patchedChannels = new Map();
  const patchedDesks    = new Map();
  try {
    onProgress?.('Merging sharedWith from Drive index…');
    driveIndex = await fetchOwnerIndex({ accessToken, folderId, expectedOwnerEmail: ownerEmail });
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

  // Step 2: classify changes by comparing index against local state.
  const { toBackup, toPull } = classifyChanges(driveIndex, syncItems, syncChannels, syncDesks);

  // Step 3: backup only the dirty items.
  const backupResult = await backupChangedItems(toBackup, {
    accessToken,
    folderId,
    items: syncItems,
    onSetDriveId,
    onSetNoteFolderData,
    onProgress,
    getPdfAnnotationSidecar,
    setPdfAnnotationDriveSync,
    onSetCoverImageDriveSync: setCoverImageDriveSync,
  });

  // Patch syncItems/syncChannels/syncDesks with newly assigned driveIds + modifiedTimes
  // so the index write reflects the results of this backup run.
  if (backupResult.updatedEntries.length > 0) {
    const patchById = new Map(backupResult.updatedEntries.map(e => [e.id, e]));
    syncItems = syncItems.map(i => {
      const p = patchById.get(i.id);
      return p ? { ...i, driveId: p.driveId, modifiedTime: p.modifiedTime, ...(p.driveFolderId ? { driveFolderId: p.driveFolderId } : {}) } : i;
    });
    syncChannels = syncChannels.map(c => {
      const p = patchById.get(c.id);
      return p ? { ...c, driveId: p.driveId, modifiedTime: p.modifiedTime } : c;
    });
    syncDesks = syncDesks.map(d => {
      const p = patchById.get(d.id);
      return p ? { ...d, driveId: p.driveId, modifiedTime: p.modifiedTime } : d;
    });
  }

  // Step 4: write the owner index when anything was backed up or sharedWith changed.
  const sharedWithPatched = patchedItems.size > 0 || patchedChannels.size > 0 || patchedDesks.size > 0;
  const hasLocalDriveContent =
    (syncItems || []).some((i) => String(i.driveId || '').trim()) ||
    (syncChannels || []).some((c) => String(c.driveId || '').trim()) ||
    (syncDesks || []).some((d) => String(d.driveId || '').trim());

  if (hasLocalDriveContent && (backupResult.updatedEntries.length > 0 || sharedWithPatched)) {
    try {
      onProgress?.('Writing owner index…');
      await writeOwnerIndex({ accessToken, folderId, ownerEmail, items: syncItems, channels: syncChannels, desks: syncDesks });
    } catch (err) {
      console.warn('[libraryDriveSync] writeOwnerIndex failed:', err);
    }
  }

  // Step 5: pull only the changed items identified by the index.
  // upsertDriveBook wrapper adds sharedWith/tags from the index entry (built into pullChangedItems).
  const syncResult = await pullChangedItems(toPull, {
    accessToken,
    upsertDriveBook: upsertDriveBook
      ? (driveFile, blob, assets) => upsertDriveBook(driveFile, blob, assets)
      : undefined,
    upsertDriveChannel,
    upsertDriveDesk,
    lazyBooks: true,
    onProgress,
    onBatchComplete,
  });

  // Step 6: sync images and sidecars via a folder listing (not tracked by the index).
  const assetResult = await syncFolderAssetsAndSidecars({
    accessToken,
    folderId,
    getImageByDriveId,
    getImageByName,
    upsertDriveImage,
    getNotes,
    getBookByName,
    upsertDriveCoverImage,
    upsertDrivePdfAnnotation,
    getAnnotationByDriveId,
    onProgress,
    onBatchComplete,
  });

  // Step 7: peer sync (unchanged).
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
    backed:       backupResult.backed,
    backupFailed: backupResult.failed,
    added:        syncResult.added + assetResult.added + peerResult.added,
    updated:      syncResult.updated + assetResult.updated,
    skipped:      syncResult.skipped + assetResult.skipped,
    removed:      peerResult.removed || 0,
    peerAdded:    peerResult.added,
    peerRemoved:  peerResult.removed || 0,
    peerFailed:   peerResult.failed,
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
  ownerEmail,
  onSetDriveId,
  onProgress,
  upsertDriveDesk,
  onBatchComplete,
}) {
  // Step 1: fetch viewer's Drive index (may be null on first run)
  let driveIndex = null;
  try {
    driveIndex = await fetchOwnerIndex({ accessToken, folderId, expectedOwnerEmail: ownerEmail });
  } catch (err) {
    console.warn('[libraryDriveSync] viewer fetchOwnerIndex failed:', err);
  }

  // Step 2: classify — desks only
  const { toBackup, toPull } = classifyChanges(driveIndex, [], [], desks);

  // Step 3: backup dirty desks
  let syncDesks = desks;
  const backupResult = await backupChangedItems(toBackup, {
    accessToken,
    folderId,
    items: [],
    onSetDriveId,
    onProgress,
  });

  if (backupResult.updatedEntries.length > 0) {
    const patchById = new Map(backupResult.updatedEntries.map(e => [e.id, e]));
    syncDesks = syncDesks.map(d => {
      const p = patchById.get(d.id);
      return p ? { ...d, driveId: p.driveId, modifiedTime: p.modifiedTime } : d;
    });
  }

  // Step 4: write viewer index if anything was backed up
  if (backupResult.updatedEntries.length > 0) {
    try {
      await writeOwnerIndex({ accessToken, folderId, ownerEmail, items: [], channels: [], desks: syncDesks });
    } catch (err) {
      console.warn('[libraryDriveSync] viewer writeOwnerIndex failed:', err);
    }
  }

  // Step 5: pull changed desks from Drive
  const syncResult = await pullChangedItems(toPull, {
    accessToken,
    upsertDriveDesk,
    lazyBooks: false,
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
