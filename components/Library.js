
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DataTile } from './DataTile.js';
import { CoverImagePickerModal } from './CoverImagePickerModal.js';
import { BookIcon } from './icons/BookIcon.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from '../utils/driveCredentials.js';
import { getDriveFolderId, setDriveFolderId, parseDriveFolderIdInput } from '../utils/driveFolderStorage.js';
import {
  getStoredAccessToken,
  removeStoredAccessToken,
  clearAllStoredAccessTokens,
  getAllStoredAccessTokens,
} from '../utils/driveOAuthStorage.js';
import { AddContentDropdown } from './AddContentDropdown.js';
import { runOwnerSyncPipeline, runViewerDeskSyncPipeline } from '../utils/libraryDriveSync.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';
import { fetchGoogleUserEmail } from '../utils/googleUser.js';
import { normalizeTag } from '../utils/tagUtils.js';
import { OWNER_DRIVE_SCOPE } from '../utils/driveScopes.js';
import { DeleteContentModal } from './DeleteContentModal.js';
import { applySharedWithToDriveFiles } from '../utils/driveSharePermissions.js';
import { getOwnerDriveAccessToken, invalidateDriveAccessTokenCache } from '../utils/driveAccessToken.js';
import { deleteDriveFilesForMergedItem, deleteDriveFilesForChannel } from '../utils/deleteLibraryContentOnDrive.js';
import { getIndexFileId, fetchOwnerIndex, writeOwnerIndex, updateOwnerIndexEntry } from '../utils/ownerIndex.js';
import { listAllUserEmails, getUserFolderId } from '../utils/userConfig.js';
import { syncSharedFromPeers } from '../utils/peerSync.js';
import {
  LIBRARY_DISPLAY_POLICIES,
  modifiedTimeSortMs,
  applyLibraryDisplayPolicy,
  readLibraryDisplayPolicy,
  writeLibraryDisplayPolicy,
} from '../utils/libraryDisplayPolicy.js';
import { formatBytes } from '../utils/fileUtils.js';
import { getSyncSettings, saveSyncSettings } from '../utils/syncSettings.js';
import {
  getDriveTokenForScope,
  peekDriveImplicitUploadToken,
  resetDriveImplicitUploadToken,
} from '../utils/driveOAuthImplicitFlowToken.js';
import { useDriveTileUpload, channelUploadKey } from '../hooks/useDriveTileUpload.js';
import { backupSingleDesk, syncSingleDeskFromDrive, pullChangedItems } from '../utils/driveSync.js';

/** Ensures startup background sync runs once per page load (survives React Strict Mode remount). */
let ownerBackgroundSyncScheduled = false;

const SEARCH_SUGGEST_MAX = 15;

const LIBRARY_PAGE_SIZE = 20;

export const Library = ({
  items, channels, desks,
  onSelectItem, onSelectChannel, onSelectDesk, onAddDesk, onRequestDeleteDesk,
  onAddItem, onSetNoteCoverImage, onDeleteItem, onClearLibrary,
  onSetDriveId, onSetNoteFolderData, onGetAllImages, getImagesForNote,
  onAddChannel, onDeleteChannel,
  getChannelByDriveId, upsertDriveChannel,
  getDeskByDriveId, upsertDriveDesk,
  getBookByDriveId, getBookByName, upsertDriveBook,
  deleteItemByDriveId, deleteChannelByDriveId, getLocalRecordsByOwnerEmail,
  getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
  getPdfAnnotationSidecar,
  setPdfAnnotationDriveSync,
  upsertDrivePdfAnnotation,
  getAnnotationByDriveId,
  setCoverImageDriveSync,
  upsertDriveCoverImage,
  setRecordTags,
  setItemSharedWith,
  mergeItemSharedWithByDriveId,
  mergeChannelSharedWithByDriveId,
  mergeDeskSharedWithByDriveId,
  deleteDeskByDriveId,
  renameItem,
  getMergedLibraryItems,
  getTotalStorageUsed,
  onGoogleUserEmail,
  onDriveCredentialsChanged,
  loadItems,
  loadChannels,
  loadAll,
  userType,
  userConfig,
  googleUserEmail,
  isSystemSettingsOpen,
  setIsSystemSettingsOpen,
  onOpenNewNote,
  onOpenYoutube,
  onOpenChannel,
  onOpenFile,
  onOpenUrl,
  onOpenImage,
  isSyncing,
  setIsSyncing,
  syncProgress,
  setSyncProgress,
  onRegisterSync,
  onRegisterItemBackup,
  onRegisterInitialDeskSync,
  onRegisterSetSharedWith,
  itemDownloadProgress,
}) => {
  const isEditor = userType === 'master' || userType === 'editor';
  const showLibraryAddMenu = isEditor || (userType === 'viewer' && typeof onAddDesk === 'function');
  const normalizedUserEmail = String(googleUserEmail || '').trim().toLowerCase();
  const searchInputRef    = useRef(null);
  const scheduleAclAfterUploadRef = useRef(() => {});
  const oauthClientModeRef = useRef(null);
  const shareAclTimerRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const runOwnerSyncRef = useRef(() => {});
  const viewerPeerSyncDoneRef = useRef(false);
  const deskBackupTimersRef = useRef(new Map());
  const desksRef = useRef(desks);
  const credentials = getDriveCredentials();
  const driveFolderId = getDriveFolderId();
  const [driveFolderDraft, setDriveFolderDraft] = useState('');
  const [storageUsed, setStorageUsed] = useState(null);
  const [storageLimitDraft, setStorageLimitDraft] = useState(() => getSyncSettings().maxStorageGB);
  const [pendingDelete, setPendingDelete] = useState(null);

  // Search state
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchSuggestIndex, setSearchSuggestIndex] = useState(-1);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [libraryPageIndex, setLibraryPageIndex] = useState(0);
  const [libraryDisplayPolicy, setLibraryDisplayPolicy] = useState(() => readLibraryDisplayPolicy());
  const [activeFilters,    setActiveFilters]    = useState(new Set());
  const [coverPickerTarget, setCoverPickerTarget] = useState(null);

  const [syncResult,  setSyncResult]  = useState(null);

  const hasCredentials = !!(
    credentials.clientId &&
    hasGoogleApiKeyOrProxy(credentials) &&
    driveFolderId.trim()
  );

  const recordHasDriveCopy = (rec) => !!(rec?.driveId && String(rec.driveId).trim());

  const handleDeleteItemRequest = (video) => {
    if (!recordHasDriveCopy(video) || !hasCredentials) {
      if (window.confirm(`Are you sure you want to delete "${video.name}"?`)) {
        onDeleteItem(video.id, video.type);
      }
      return;
    }
    setPendingDelete({ kind: 'item', item: video });
  };

  const handleDeleteChannelRequest = (ch) => {
    if (!recordHasDriveCopy(ch) || !hasCredentials) {
      if (window.confirm(`Remove channel "${ch.name}" from your library?`)) {
        onDeleteChannel(ch.id);
      }
      return;
    }
    setPendingDelete({ kind: 'channel', channel: ch });
  };

  const handleDeleteDeskRequest = (desk) => {
    if (!onRequestDeleteDesk) return;
    onRequestDeleteDesk(desk);
  };

  const closePendingDelete = () => setPendingDelete(null);

  const runPendingDeleteLocal = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === 'item') {
        await onDeleteItem(pendingDelete.item.id, pendingDelete.item.type);
      } else {
        await onDeleteChannel(pendingDelete.channel.id);
      }
      closePendingDelete();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not remove from library.');
    }
  };

  const runPendingDeleteWithDrive = async () => {
    if (!pendingDelete) return;
    try {
      const token = await getOwnerDriveAccessToken();
      if (pendingDelete.kind === 'item') {
        await deleteDriveFilesForMergedItem(token, pendingDelete.item, getImagesForNote);
        await onDeleteItem(pendingDelete.item.id, pendingDelete.item.type);
      } else {
        await deleteDriveFilesForChannel(token, pendingDelete.channel);
        await onDeleteChannel(pendingDelete.channel.id);
      }
      closePendingDelete();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not delete on Google Drive or remove locally.');
    }
  };

  useEffect(() => {
    if (!isSystemSettingsOpen) return;
    setDriveFolderDraft(getDriveFolderId());
    setStorageLimitDraft(getSyncSettings().maxStorageGB);
    if (getTotalStorageUsed) getTotalStorageUsed().then(setStorageUsed);
  }, [isSystemSettingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tags for card dropdowns: union of item and channel tags
  const availableTags = useMemo(() => {
    const fromAll = new Set();
    for (const it of items) {
      for (const t of it.tags || []) {
        const n = normalizeTag(t);
        if (n) fromAll.add(n);
      }
    }
    for (const ch of channels || []) {
      for (const t of ch.tags || []) {
        const n = normalizeTag(t);
        if (n) fromAll.add(n);
      }
    }
    return [...fromAll].sort();
  }, [items, channels]);

  const shareableUserEmails = useMemo(() => {
    const all = listAllUserEmails(userConfig).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean);
    if (!all.length) return [];
    return all.filter((email) => email !== normalizedUserEmail);
  }, [userConfig, normalizedUserEmail]);

  const canEditShareForRecord = (record) => {
    if (!isEditor) return false;
    if (!record) return false;
    const owner = String(record.ownerEmail || '').trim().toLowerCase();
    // Local rows may not have ownerEmail set yet; treat them as editable by current owner.
    if (!owner) return true;
    return owner === normalizedUserEmail;
  };

  const reconcileShareAclNow = async ({
    overrideRecord = null,
    overrideStore = '',
    overrideEmails = null,
    previousSharedWith = null,
    targetedOnly = false,
  } = {}) => {
    if (!credentials.clientId) return null;
    console.log('[InfoDepo] ACL step: acquire token');
    const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
    let itemsForAcl = [];
    let channelsForAcl = [];
    let desksForAcl = [];
    if (targetedOnly && overrideRecord) {
      if (overrideStore === 'channels') {
        channelsForAcl = [{ ...overrideRecord, sharedWith: overrideEmails || [] }];
      } else if (overrideStore === 'desks') {
        desksForAcl = [{ ...overrideRecord, sharedWith: overrideEmails || [] }];
        // Also include all items/channels inside the desk with their current sharedWith so
        // their Drive permissions are granted in the same pass.
        const layoutDriveIds = Object.keys(overrideRecord.layout || {})
          .filter((k) => k.startsWith('drive:'))
          .map((k) => k.slice(6).trim())
          .filter(Boolean);
        for (const driveId of layoutDriveIds) {
          const item = items.find((i) => String(i.driveId || '').trim() === driveId);
          if (item) { itemsForAcl.push(item); continue; }
          const ch = (channels || []).find((c) => String(c.driveId || '').trim() === driveId);
          if (ch) channelsForAcl.push(ch);
        }
      } else {
        itemsForAcl = [{ ...overrideRecord, sharedWith: overrideEmails || [] }];
      }
    } else {
      console.log('[InfoDepo] ACL step: load merged library items');
      const mergedItems = await getMergedLibraryItems();
      itemsForAcl =
        overrideRecord && overrideStore !== 'channels' && overrideStore !== 'desks'
          ? mergedItems.map((it) =>
              it.id === overrideRecord.id && it.idbStore === overrideStore
                ? { ...it, sharedWith: overrideEmails || [] }
                : it
            )
          : mergedItems;
      channelsForAcl =
        overrideRecord && overrideStore === 'channels'
          ? (channels || []).map((ch) =>
              ch.id === overrideRecord.id ? { ...ch, sharedWith: overrideEmails || [] } : ch
            )
          : (channels || []);
      desksForAcl =
        overrideRecord && overrideStore === 'desks'
          ? (desks || []).map((dk) =>
              dk.id === overrideRecord.id ? { ...dk, sharedWith: overrideEmails || [] } : dk
            )
          : (desks || []);
    }
    let indexFid = null;
    let prevIndex = null;
    if (targetedOnly && overrideRecord && Array.isArray(previousSharedWith)) {
      prevIndex = {
        items: [{ driveId: String(overrideRecord.driveId || '').trim(), sharedWith: previousSharedWith }],
      };
    }
    if (String(driveFolderId || '').trim()) {
      try {
        console.log('[InfoDepo] ACL step: lookup owner index file');
        indexFid = await getIndexFileId(token, driveFolderId);
        if (!targetedOnly) {
          console.log('[InfoDepo] ACL step: fetch previous owner index', { hasIndexFile: !!indexFid });
          prevIndex = indexFid ? await fetchOwnerIndex({ accessToken: token, folderId: driveFolderId }) : null;
        }
      } catch (e) {
        console.warn('[InfoDepo] index lookup skipped during ACL reconcile:', e);
      }
    }
    // In targeted mode, grant index access to any newly added user without revoking previous
    // users — targeted reconcile has no global view, so index revocation is deferred to full reconcile.
    if (targetedOnly && indexFid) {
      const indexEmails = [
        ...new Set([
          ...(Array.isArray(overrideEmails) ? overrideEmails : []),
          ...(Array.isArray(previousSharedWith) ? previousSharedWith : []),
        ]),
      ];
      if (indexEmails.length > 0) {
        itemsForAcl = [...itemsForAcl, { driveId: indexFid, sharedWith: indexEmails }];
      }
    }
    console.log('[InfoDepo] ACL step: apply Drive permissions');
    const aclPromise = applySharedWithToDriveFiles({
      accessToken: token,
      items: itemsForAcl,
      channels: channelsForAcl,
      desks: desksForAcl,
      indexFileId: indexFid,
      previousIndex: prevIndex,
      onProgress: () => {},
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Drive authorization reconcile timed out after 20s.')), 20000);
    });
    return Promise.race([aclPromise, timeoutPromise]);
  };

  const handleSetSharedWith = async (record, storeName, emails) => {
    const previousSharedWith = Array.isArray(record?.sharedWith) ? [...record.sharedWith] : [];
    await setItemSharedWith(record.id, storeName, emails);

    // Track channel mutations so we can patch stale React state when writing the index.
    // loadChannels/loadDesks are async — state won't have caught up by the time writeOwnerIndex runs.
    const propagatedChannelUpdates = new Map(); // channelId → merged sharedWith

    // When sharing a desk, propagate newly added emails to all items/channels in the layout.
    // Removal from the desk does NOT revoke item-level access (items may be independently shared).
    if (storeName === 'desks') {
      const newEmailSet = new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean));
      const prevEmailSet = new Set(previousSharedWith.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
      const addedEmails = [...newEmailSet].filter((e) => !prevEmailSet.has(e));
      if (addedEmails.length > 0) {
        const layoutDriveIds = Object.keys(record.layout || {})
          .filter((k) => k.startsWith('drive:'))
          .map((k) => k.slice(6).trim())
          .filter(Boolean);
        for (const driveId of layoutDriveIds) {
          const item = items.find((i) => String(i.driveId || '').trim() === driveId);
          if (item) {
            const merged = [...new Set([...(item.sharedWith || []), ...addedEmails])];
            await setItemSharedWith(item.id, item.idbStore, merged);
            continue;
          }
          const ch = (channels || []).find((c) => String(c.driveId || '').trim() === driveId);
          if (ch) {
            const merged = [...new Set([...(ch.sharedWith || []), ...addedEmails])];
            await setItemSharedWith(ch.id, 'channels', merged);
            propagatedChannelUpdates.set(ch.id, merged);
          }
        }
      }
    }

    const recordDriveId = String(record?.driveId || '').trim();
    if (!recordDriveId) {
      console.warn('[InfoDepo] Share updated locally, but Drive authorization skipped because this record has no driveId yet. Upload it to Google Drive first.', {
        recordId: record?.id,
        storeName,
        sharedWith: emails,
      });
      return;
    }
    if (shareAclTimerRef.current) {
      clearTimeout(shareAclTimerRef.current);
      shareAclTimerRef.current = null;
    }
    try {
      console.log('[InfoDepo] Starting Drive authorization reconcile for sharedWith change...', {
        recordId: record.id,
        storeName,
        driveId: recordDriveId,
        sharedWith: emails,
      });
      const aclResult = await reconcileShareAclNow({
        overrideRecord: record,
        overrideStore: storeName,
        overrideEmails: emails,
        previousSharedWith,
        targetedOnly: true,
      });
      if (aclResult) {
        console.log('[InfoDepo] Drive authorization reconcile result:', {
          recordId: record.id,
          storeName,
          sharedWith: emails,
          granted: aclResult.granted,
          failed: aclResult.failed,
          revoked: aclResult.revoked,
          revokeFailed: aclResult.revokeFailed,
        });
      }
      if (aclResult && aclResult.failed > 0) {
        window.alert(`Some Google Drive permission updates failed (${aclResult.failed}). The recipient may not see this item yet.`);
      }
      // Ensure receivers can discover latest sharedWith changes without waiting for full Sync.
      // writeOwnerIndex only needs the OAuth token, not an API key.
      if (String(driveFolderId || '').trim()) {
        try {
          const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
          const mergedItems = await getMergedLibraryItems();
          // React state for channels/desks may be stale — loadChannels/loadDesks from
          // setItemSharedWith are async and likely haven't resolved yet. Patch the
          // changed record and any channels updated by desk propagation directly.
          const channelsForIndex = (channels || []).map((c) => {
            if (storeName === 'channels' && c.id === record.id) return { ...c, sharedWith: emails };
            if (propagatedChannelUpdates.has(c.id)) return { ...c, sharedWith: propagatedChannelUpdates.get(c.id) };
            return c;
          });
          const desksForIndex = storeName === 'desks'
            ? (desks || []).map((d) => d.id === record.id ? { ...d, sharedWith: emails } : d)
            : (desks || []);
          await writeOwnerIndex({
            accessToken: token,
            folderId: driveFolderId,
            ownerEmail: normalizedUserEmail,
            items: mergedItems,
            channels: channelsForIndex,
            desks: desksForIndex,
          });
          console.log('[InfoDepo] Owner index updated after sharedWith change.');
        } catch (idxErr) {
          console.warn('[InfoDepo] Failed to update owner index after sharedWith change:', idxErr);
        }
      } else {
        console.warn('[InfoDepo] Skipped owner index update after sharedWith change (missing folderId or API key/proxy).');
      }
    } catch (e) {
      console.error('[InfoDepo] ACL reconcile after share change failed:', e);
      window.alert(e?.message || 'Failed to update Google Drive permissions for this share change.');
    } finally {
      console.log('[InfoDepo] Drive authorization reconcile finished for sharedWith change.', {
        recordId: record.id,
        storeName,
      });
    }
  };

  /** Debounced helper used by upload flows to reconcile Drive ACLs. */
  const scheduleShareAclReconcile = () => {
    if (!hasCredentials) return;
    if (shareAclTimerRef.current) clearTimeout(shareAclTimerRef.current);
    shareAclTimerRef.current = setTimeout(async () => {
      shareAclTimerRef.current = null;
      try {
        await reconcileShareAclNow();
      } catch (e) {
        console.warn('[InfoDepo] share ACL reconcile after change:', e);
      }
    }, 450);
  };

  scheduleAclAfterUploadRef.current = scheduleShareAclReconcile;

  const { uploadStatuses, handleUpload, handleChannelUpload } = useDriveTileUpload({
    onSetDriveId,
    scheduleShareAclReconcile: () => scheduleAclAfterUploadRef.current(),
  });

  useEffect(
    () => () => {
      if (shareAclTimerRef.current) clearTimeout(shareAclTimerRef.current);
    },
    []
  );

  // Clear in-memory token when client ID changes.
  useEffect(() => {
    const clientId = credentials.clientId;
    if (oauthClientModeRef.current === null) {
      oauthClientModeRef.current = clientId;
    } else if (oauthClientModeRef.current !== clientId) {
      clearAllStoredAccessTokens();
      oauthClientModeRef.current = clientId;
    }
    resetDriveImplicitUploadToken();
    invalidateDriveAccessTokenCache();
  }, [credentials.clientId]);

  useEffect(() => {
    viewerPeerSyncDoneRef.current = false;
  }, [googleUserEmail]);

  useEffect(() => {
    if (!onGoogleUserEmail) return;
    if (!hasCredentials) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
        const email = await fetchGoogleUserEmail(token);
        if (!cancelled) onGoogleUserEmail(email);
      } catch {
        if (!cancelled) onGoogleUserEmail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [hasCredentials, credentials.clientId, onGoogleUserEmail]);

  useEffect(() => {
    console.log('[InfoDepo][viewerAutoSync] effect fired', { userType, googleUserEmail, hasUserConfig: !!userConfig, done: viewerPeerSyncDoneRef.current, inFlight: syncInFlightRef.current });
    if (userType !== 'viewer') return;
    if (!googleUserEmail || !userConfig) { console.log('[InfoDepo][viewerAutoSync] blocked: missing email or userConfig'); return; }
    if (viewerPeerSyncDoneRef.current) { console.log('[InfoDepo][viewerAutoSync] blocked: already done'); return; }
    if (syncInFlightRef.current) { console.log('[InfoDepo][viewerAutoSync] blocked: sync in flight'); return; }
    viewerPeerSyncDoneRef.current = true;

    let cancelled = false;
    (async () => {
      syncInFlightRef.current = true;
      setIsSyncing(true);
      setSyncProgress('');
      setSyncResult(null);
      try {
        // On iOS Safari, requestAccessToken({ prompt:'' }) requires a user gesture when
        // the stored token has expired — the silent GIS iframe refresh is blocked by ITP.
        // Pre-check the stored token; if absent, skip the auto-sync and prompt the user
        // to tap the Sync button (which runs under a user gesture and succeeds).
        const storedToken = getStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
        if (!storedToken) {
          viewerPeerSyncDoneRef.current = false;
          if (!cancelled) setSyncResult({ error: 'Session expired — tap Sync to sign in again.' });
          return;
        }
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);

        // Pull viewer's own desks from their personal Drive folder first so they
        // appear immediately, before shared content from peers is processed.
        let deskResult = { backed: 0, backupFailed: 0, added: 0, updated: 0, skipped: 0 };
        const viewerFolderId = getUserFolderId(googleUserEmail, userConfig);
        if (viewerFolderId) {
          setSyncProgress('Loading viewer desks…');
          deskResult = await runViewerDeskSyncPipeline({
            accessToken: token,
            folderId: viewerFolderId,
            desks,
            ownerEmail: normalizedUserEmail,
            onSetDriveId: (id, storeName, driveId, syncMeta = null) =>
              onSetDriveId(id, storeName, driveId, { ...(syncMeta || {}), silent: true }),
            onProgress: setSyncProgress,
            upsertDriveDesk: (driveFile, deskData) =>
              upsertDriveDesk(driveFile, deskData, { silent: true }),
            onBatchComplete: loadAll,
          });
          if (!cancelled) loadAll();
        }

        if (cancelled) return;
        setSyncProgress('Checking shared content from configured users...');
        const peerResult = await syncSharedFromPeers({
          accessToken: token,
          myEmail: googleUserEmail,
          config: userConfig,
          getBookByDriveId,
          upsertDriveBook: (driveFile, blob, assets) =>
            upsertDriveBook(driveFile, blob, assets, { silent: true }),
          getChannelByDriveId,
          upsertDriveChannel: (driveFile, channelData) =>
            upsertDriveChannel(driveFile, channelData, { silent: true }),
          getDeskByDriveId,
          upsertDriveDesk: (driveFile, deskData) =>
            upsertDriveDesk(driveFile, deskData, { silent: true }),
          getLocalRecordsByOwnerEmail,
          deleteItemByDriveId,
          deleteChannelByDriveId,
          deleteDeskByDriveId,
          onProgress: setSyncProgress,
          lazyBooks: true,
          onBatchComplete: loadAll,
        });

        // Also try the viewer's linked driveFolderId as a direct owner folder.
        // This handles the common case where the viewer entered the owner's folder
        // at setup but the config does not have the owner's folderId recorded.
        let linkedResult = { added: 0, updated: 0, skipped: 0 };
        if (!cancelled && driveFolderId) {
          setSyncProgress('Checking linked Drive folder for shared content…');
          try {
            linkedResult = await pullSharedFromLinkedFolder(token, driveFolderId, googleUserEmail);
            if (linkedResult.added > 0 || linkedResult.updated > 0) loadAll();
          } catch (err) {
            console.warn('[InfoDepo][viewerSync] linked folder pull failed:', err?.message);
          }
        }

        if (!cancelled) {
          console.log('[InfoDepo][viewer-sync] peerSync complete', peerResult, 'linkedFolder:', linkedResult, '— calling loadAll');
          loadAll();
          setSyncResult({
            sharedFor: googleUserEmail,
            backed: deskResult.backed,
            backupFailed: deskResult.backupFailed,
            added: deskResult.added + peerResult.added + linkedResult.added,
            updated: (deskResult.updated || 0) + (peerResult.updated || 0) + (linkedResult.updated || 0),
            skipped: deskResult.skipped,
            removed: peerResult.removed || 0,
            failed: peerResult.failed,
            peerAdded: peerResult.added + linkedResult.added,
            peerRemoved: peerResult.removed || 0,
            peerFailed: peerResult.failed,
          });
        }
      } catch (err) {
        console.error('[InfoDepo][viewer-sync] error:', err?.message || err);
        if (!cancelled) setSyncResult({ error: err?.message || 'Viewer shared-content sync failed.' });
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
        setSyncProgress('');
      }
    })();

    // Reset the done-flag in cleanup so Strict Mode's second mount can retry.
    return () => {
      cancelled = true;
      viewerPeerSyncDoneRef.current = false;
    };
  }, [
    userType,
    googleUserEmail,
    userConfig,
    getBookByDriveId,
    upsertDriveBook,
    getChannelByDriveId,
    upsertDriveChannel,
    loadAll,
  ]);

  const handleConfirmClear = () => {
    if (window.confirm('Delete the local database and reinitialize? All locally stored content will be removed. This cannot be undone.')) {
      onClearLibrary();
    }
  };

  const handleSignOutGoogle = () => {
    const tokens = new Set();
    const implicit = peekDriveImplicitUploadToken();
    if (implicit) tokens.add(implicit);
    for (const t of getAllStoredAccessTokens(credentials.clientId)) tokens.add(t);
    resetDriveImplicitUploadToken();
    clearAllStoredAccessTokens();
    invalidateDriveAccessTokenCache();
    onGoogleUserEmail?.(null);
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      tokens.forEach((token) => google.accounts.oauth2.revoke(token, () => {}));
    }
    onDriveCredentialsChanged?.();
  };

  // Pull items shared with viewerEmail from the owner's index in the given folderId.
  // Used when the viewer has the owner's folder linked but it's not in the config.
  const pullSharedFromLinkedFolder = async (accessToken, folderId, viewerEmail) => {
    const counts = { added: 0, updated: 0, skipped: 0 };
    if (!folderId || !viewerEmail) return counts;
    const index = await fetchOwnerIndex({ accessToken, folderId });
    if (!index || !Array.isArray(index.items)) return counts;
    const ownerEmail = String(index.ownerEmail || '').trim().toLowerCase();
    const me = viewerEmail.trim().toLowerCase();
    if (ownerEmail && ownerEmail === me) return counts; // viewer's own folder; already handled
    console.log('[InfoDepo][viewerSync] linked folder index:', { ownerEmail, totalItems: index.items.length });

    const sharedWithMe = index.items.filter(entry =>
      Array.isArray(entry.sharedWith) &&
      entry.sharedWith.some(e => String(e).trim().toLowerCase() === me)
    );
    console.log('[InfoDepo][viewerSync] items shared with me from linked folder:', sharedWithMe.length);
    if (!sharedWithMe.length) return counts;

    // Freshness check: only pull items absent from IDB or where Drive is newer.
    // Inject ownerEmail so upsertDriveBook stores it correctly for future pruning.
    const toPull = [];
    for (const entry of sharedWithMe) {
      const did = String(entry.driveId || '').trim();
      if (!did) continue;
      let existing = await getBookByDriveId(did);
      if (!existing && entry.type === 'infodepo-channel') existing = await getChannelByDriveId(did);
      if (!existing && entry.type === 'infodepo-desk') existing = await getDeskByDriveId(did);
      if (!existing || !existing.modifiedTime || !entry.modifiedTime ||
          new Date(entry.modifiedTime) > new Date(existing.modifiedTime)) {
        toPull.push(ownerEmail ? { ...entry, ownerEmail } : entry);
      }
    }
    console.log('[InfoDepo][viewerSync] toPull from linked folder:', toPull.length);
    if (!toPull.length) return counts;

    const r = await pullChangedItems(toPull, {
      accessToken,
      upsertDriveBook: (driveFile, blob, assets) =>
        upsertDriveBook(driveFile, blob, assets, { silent: true }),
      upsertDriveChannel: (driveFile, channelData) =>
        upsertDriveChannel(driveFile, channelData, { silent: true }),
      upsertDriveDesk: (driveFile, deskData) =>
        upsertDriveDesk(driveFile, deskData, { silent: true }),
      lazyBooks: true,
      onProgress: setSyncProgress,
      onBatchComplete: loadAll,
    });
    return r;
  };

  const runOwnerSync = async () => {
    console.log('[InfoDepo][ownerSync] runOwnerSync called', { userType, hasCredentials, inFlight: syncInFlightRef.current, driveFolderId });
    if (userType === 'viewer') { console.log('[InfoDepo][ownerSync] blocked: userType=viewer'); return; }
    if (!hasCredentials) { console.log('[InfoDepo][ownerSync] blocked: no credentials'); return; }
    if (syncInFlightRef.current) { console.log('[InfoDepo][ownerSync] blocked: sync already in flight'); return; }
    console.log('[InfoDepo][ownerSync] starting', { userType, driveFolderId, items: items.length, channels: channels.length, desks: desks.length });
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncResult(null);
    setSyncProgress('');
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);

      setSyncProgress('Backing up local items...');
      const combined = await runOwnerSyncPipeline({
        accessToken: token,
        folderId: driveFolderId,
        items,
        channels,
        desks,
        ownerEmail: googleUserEmail,
        config: userConfig,
        onSetDriveId: (id, storeName, driveId, syncMeta = null) =>
          onSetDriveId(id, storeName, driveId, { ...(syncMeta || {}), silent: true }),
        onSetNoteFolderData: (noteId, folderId, assetDriveIds) =>
          onSetNoteFolderData(noteId, folderId, assetDriveIds, { silent: true }),
        onProgress: setSyncProgress,
        getBookByDriveId,
        getBookByName,
        upsertDriveBook: (driveFile, blob, assets) =>
          upsertDriveBook(driveFile, blob, assets, { silent: true }),
        getImageByDriveId,
        getImageByName,
        upsertDriveImage,
        getNotes,
        getChannelByDriveId,
        upsertDriveChannel: (driveFile, channelData) =>
          upsertDriveChannel(driveFile, channelData, { silent: true }),
        getDeskByDriveId,
        upsertDriveDesk: (driveFile, deskData) =>
          upsertDriveDesk(driveFile, deskData, { silent: true }),
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
        onBatchComplete: loadAll,
      });
      console.log('[InfoDepo] ownerSync result:', combined);
      loadAll();
      setSyncResult(combined);
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncResult({ error: err.message });
      resetDriveImplicitUploadToken();
      removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const runViewerPeerSync = async () => {
    console.log('[InfoDepo][viewerSync] runViewerPeerSync called', { userType, googleUserEmail, hasUserConfig: !!userConfig, inFlight: syncInFlightRef.current });
    if (userType !== 'viewer') { console.log('[InfoDepo][viewerSync] blocked: userType is not viewer:', userType); return; }
    if (syncInFlightRef.current) { console.log('[InfoDepo][viewerSync] blocked: sync already in flight'); return; }
    if (!googleUserEmail) { console.log('[InfoDepo][viewerSync] blocked: no googleUserEmail'); return; }
    if (!userConfig) { console.log('[InfoDepo][viewerSync] blocked: userConfig is null (VITE_CONFIG not set?)'); return; }
    console.log('[InfoDepo][viewerSync] starting', { googleUserEmail, userConfig });
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncResult(null);
    setSyncProgress('');

    let deskResult = { backed: 0, backupFailed: 0, added: 0, updated: 0, skipped: 0 };

    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);

      const viewerFolderId = getUserFolderId(googleUserEmail, userConfig);
      if (viewerFolderId) {
        setSyncProgress('Backing up viewer desks…');
        deskResult = await runViewerDeskSyncPipeline({
          accessToken: token,
          folderId: viewerFolderId,
          desks,
          ownerEmail: normalizedUserEmail,
          onSetDriveId: (id, storeName, driveId, syncMeta = null) =>
            onSetDriveId(id, storeName, driveId, { ...(syncMeta || {}), silent: true }),
          onProgress: setSyncProgress,
          upsertDriveDesk: (driveFile, deskData) =>
            upsertDriveDesk(driveFile, deskData, { silent: true }),
          onBatchComplete: loadAll,
        });
      }

      setSyncProgress('Checking shared content from configured users...');
      const peerResult = await syncSharedFromPeers({
        accessToken: token,
        myEmail: googleUserEmail,
        config: userConfig,
        getBookByDriveId,
        upsertDriveBook: (driveFile, blob, assets) =>
          upsertDriveBook(driveFile, blob, assets, { silent: true }),
        getChannelByDriveId,
        upsertDriveChannel: (driveFile, channelData) =>
          upsertDriveChannel(driveFile, channelData, { silent: true }),
        getDeskByDriveId,
        upsertDriveDesk: (driveFile, deskData) =>
          upsertDriveDesk(driveFile, deskData, { silent: true }),
        getLocalRecordsByOwnerEmail,
        deleteItemByDriveId,
        deleteChannelByDriveId,
        deleteDeskByDriveId,
        upsertDriveCoverImage,
        onProgress: setSyncProgress,
        onBatchComplete: loadAll,
        lazyBooks: true,
      });

      // Also check the viewer's linked driveFolderId as a direct owner folder.
      let linkedResult = { added: 0, updated: 0, skipped: 0 };
      if (driveFolderId) {
        setSyncProgress('Checking linked Drive folder for shared content…');
        try {
          linkedResult = await pullSharedFromLinkedFolder(token, driveFolderId, googleUserEmail);
          if (linkedResult.added > 0 || linkedResult.updated > 0) loadAll();
        } catch (err) {
          console.warn('[InfoDepo][viewerSync] linked folder pull failed:', err?.message);
        }
      }

      loadAll();
      setSyncResult({
        sharedFor:    googleUserEmail,
        backed:       deskResult.backed,
        backupFailed: deskResult.backupFailed,
        added:        deskResult.added + peerResult.added + linkedResult.added,
        updated:      (deskResult.updated || 0) + (peerResult.updated || 0) + (linkedResult.updated || 0),
        skipped:      deskResult.skipped,
        removed:      peerResult.removed || 0,
        failed:       peerResult.failed,
        peerAdded:    peerResult.added + linkedResult.added,
        peerRemoved:  peerResult.removed || 0,
        peerFailed:   peerResult.failed,
      });
    } catch (err) {
      setSyncResult({ error: err?.message || 'Viewer sync failed.' });
      removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const runSync = () => (userType === 'viewer' ? runViewerPeerSync() : runOwnerSync());

  runOwnerSyncRef.current = runOwnerSync;
  onRegisterSync?.(runSync);

  // Keep desksRef current so the debounced backup callback always reads the latest IDB state.
  desksRef.current = desks;

  const triggerDeskBackup = (deskId) => {
    if (!credentials?.clientId || !String(driveFolderId || '').trim()) return;
    if (userType !== 'master' && userType !== 'editor') return;
    clearTimeout(deskBackupTimersRef.current.get(deskId));
    deskBackupTimersRef.current.set(deskId, setTimeout(async () => {
      deskBackupTimersRef.current.delete(deskId);
      const desk = desksRef.current.find((d) => d.id === deskId);
      if (!desk) return;
      try {
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
        if (!token) return;
        let capturedDriveId = null;
        let capturedModifiedTime = null;
        const wrappedOnSetDriveId = async (id, storeName, driveId, meta) => {
          await onSetDriveId(id, storeName, driveId, meta);
          capturedDriveId = driveId;
          capturedModifiedTime = meta?.modifiedTime;
        };
        const result = await backupSingleDesk(desk, { accessToken: token, folderId: driveFolderId, onSetDriveId: wrappedOnSetDriveId });
        if (result === 'backed' && capturedDriveId) {
          try {
            await updateOwnerIndexEntry(capturedDriveId, {
              modifiedTime: capturedModifiedTime || '',
              name: desk.name,
              type: 'infodepo-desk',
              sharedWith: Array.isArray(desk.sharedWith) ? desk.sharedWith : [],
              tags: Array.isArray(desk.tags) ? desk.tags : [],
            }, { accessToken: token, folderId: driveFolderId, ownerEmail: normalizedUserEmail });
          } catch (indexErr) {
            console.warn('[InfoDepo] index update after desk backup failed:', indexErr.message);
          }
        }
      } catch (err) {
        console.warn('[InfoDepo] single desk backup failed:', err.message);
      }
    }, 3000));
  };

  onRegisterItemBackup?.((id, storeName) => {
    if (storeName === 'desks') triggerDeskBackup(id);
  });

  onRegisterSetSharedWith?.((record, storeName, emails) => handleSetSharedWith(record, storeName, emails));

  onRegisterInitialDeskSync?.(async (desk) => {
    if (!credentials?.clientId || !String(driveFolderId || '').trim()) return;
    if (userType !== 'master' && userType !== 'editor') return;
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
      if (!token) return;
      await syncSingleDeskFromDrive(desk, { accessToken: token, upsertDriveDesk });
    } catch (err) {
      console.warn('[InfoDepo] initial desk sync failed:', err.message);
    }
  });

  useEffect(() => {
    console.log('[InfoDepo][autoSync] effect fired', { hasCredentials, driveFolderId, userType, ownerBackgroundSyncScheduled });
    if (!hasCredentials || !String(driveFolderId || '').trim()) { console.log('[InfoDepo][autoSync] blocked: no creds or folder'); return; }
    if (userType !== 'master' && userType !== 'editor') { console.log('[InfoDepo][autoSync] blocked: userType:', userType); return; }
    if (ownerBackgroundSyncScheduled) { console.log('[InfoDepo][autoSync] blocked: already scheduled'); return; }
    ownerBackgroundSyncScheduled = true;
    console.log('[InfoDepo][autoSync] scheduling owner sync');
    // Call directly — no setTimeout so Strict Mode cleanup can't cancel it.
    runOwnerSyncRef.current();
  }, [hasCredentials, driveFolderId, userType]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFilter = (filter) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const query = searchQuery.trim().toLowerCase();

  /** Name substring (case-insensitive) or any tag whose normalized form contains the normalized query. */
  const matchesNameOrTags = (name, tags) => {
    if (!query) return true;
    if ((name || '').toLowerCase().includes(query)) return true;
    const nq = normalizeTag(query);
    if (!nq) return false;
    for (const t of tags || []) {
      const nt = normalizeTag(t);
      if (nt && nt.includes(nq)) return true;
    }
    return false;
  };


  const filteredItems = useMemo(() => items.filter(item => {
    if (item.name === '_infodepo_index.json') return false;
    if (activeFilters.size > 0) {
      const effectiveKey =
        item.type === 'application/x-url' ? 'url'
        : String(item.type || '').startsWith('image/') ? 'images'
        : item.idbStore;
      if (!activeFilters.has(effectiveKey)) return false;
    }
    if (query && !matchesNameOrTags(item.name, item.tags)) return false;
    return true;
  }), [items, activeFilters, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredChannels = useMemo(() => (channels || []).filter(ch => {
    if (activeFilters.size > 0 && !activeFilters.has('channels')) return false;
    if (query && !matchesNameOrTags(ch.name || ch.handle, ch.tags)) return false;
    return true;
  }), [channels, activeFilters, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredDesks = useMemo(() => (desks || []).filter(d => {
    if (activeFilters.size > 0 && !activeFilters.has('desks')) return false;
    if (query && !matchesNameOrTags(d.name, d.tags)) return false;
    return true;
  }), [desks, activeFilters, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalGridCount = items.length + (channels || []).length + (desks || []).length;
  const filteredGridCount = filteredItems.length + filteredChannels.length + filteredDesks.length;

  const sortedLibraryRows = useMemo(() => {
    const rows = [];
    for (const video of filteredItems) {
      rows.push({ kind: 'item', data: video, sortMs: modifiedTimeSortMs(video) });
    }
    for (const ch of filteredChannels) {
      rows.push({ kind: 'channel', data: ch, sortMs: modifiedTimeSortMs(ch) });
    }
    for (const d of filteredDesks) {
      rows.push({ kind: 'desk', data: d, sortMs: modifiedTimeSortMs(d) });
    }
    return applyLibraryDisplayPolicy(rows, libraryDisplayPolicy);
  }, [filteredItems, filteredChannels, filteredDesks, libraryDisplayPolicy]);

  const libraryPageRows = useMemo(() => {
    const start = libraryPageIndex * LIBRARY_PAGE_SIZE;
    return sortedLibraryRows.slice(start, start + LIBRARY_PAGE_SIZE);
  }, [sortedLibraryRows, libraryPageIndex]);

  const libraryTotalPages = Math.max(1, Math.ceil(sortedLibraryRows.length / LIBRARY_PAGE_SIZE) || 1);

  const activeFiltersKey = useMemo(() => [...activeFilters].sort().join('\0'), [activeFilters]);

  useEffect(() => {
    setLibraryPageIndex(0);
  }, [searchQuery, activeFiltersKey]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(sortedLibraryRows.length / LIBRARY_PAGE_SIZE) || 1);
    const maxIdx = Math.max(0, tp - 1);
    if (libraryPageIndex > maxIdx) setLibraryPageIndex(maxIdx);
  }, [sortedLibraryRows.length, libraryPageIndex]);

  const hasActiveSearch = query || activeFilters.size > 0;

  const searchSuggestionPool = useMemo(() => {
    const rows = [];
    const seenName = new Set();

    const addName = (raw, category, labelOverride) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seenName.has(key)) return;
      seenName.add(key);
      const label = labelOverride != null ? labelOverride : trimmed;
      rows.push({ kind: 'name', category, label, value: trimmed });
    };

    for (const it of items) {
      const raw = it.name || '';
      if (it.type === 'application/x-youtube') {
        addName(raw, 'item', raw.replace(/\.youtube$/i, ''));
      } else {
        addName(raw, 'item');
      }
    }
    for (const ch of channels || []) {
      addName(ch.name || ch.handle || '', 'channel');
    }

    const tagSeen = new Set();
    for (const t of availableTags) {
      const n = normalizeTag(t);
      if (!n || tagSeen.has(n)) continue;
      tagSeen.add(n);
      rows.push({ kind: 'tag', category: 'tag', label: n, value: n });
    }

    return rows;
  }, [items, channels, availableTags]);

  const searchSuggestions = useMemo(() => {
    const raw = searchQuery.trim();
    const q = raw.toLowerCase();
    if (!q) return [];

    const out = [];
    for (const row of searchSuggestionPool) {
      if (row.kind === 'tag') {
        const nt = normalizeTag(row.value);
        const nq = normalizeTag(raw);
        if (nt && nq && nt.includes(nq)) out.push(row);
      } else if ((row.value || '').toLowerCase().includes(q)) {
        out.push(row);
      }
    }

    out.sort((a, b) => {
      const va = (a.value || '').toLowerCase();
      const vb = (b.value || '').toLowerCase();
      const rank = (v) => (v.startsWith(q) ? 0 : v.includes(q) ? 1 : 2);
      const ra = rank(va);
      const rb = rank(vb);
      if (ra !== rb) return ra - rb;
      return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' });
    });

    return out.slice(0, SEARCH_SUGGEST_MAX);
  }, [searchSuggestionPool, searchQuery]);

  useEffect(() => {
    setSearchSuggestIndex(-1);
  }, [searchQuery]);

  const applySearchSuggestion = (row) => {
    setSearchQuery(row.value);
    setSearchSuggestIndex(-1);
  };

  const handleSearchKeyDown = (e) => {
    if (!searchSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchSuggestIndex((i) => Math.min(searchSuggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchSuggestIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && searchSuggestIndex >= 0) {
      e.preventDefault();
      const row = searchSuggestions[searchSuggestIndex];
      if (row) applySearchSuggestion(row);
    } else if (e.key === 'Escape') {
      setSearchSuggestIndex(-1);
    }
  };

  const folderBadge = hasCredentials && isEditor && React.createElement(
    'span',
    {
      className: 'flex items-center gap-1 bg-gray-800 border border-gray-600/40 text-gray-300 text-xs font-mono px-2.5 py-1.5 rounded-lg',
      title: driveFolderId ? `Linked folder: ${driveFolderId}` : '',
    },
    React.createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3 w-3 shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 7a2 2 0 012-2h3.586a1 1 0 01.707.293L11 7h10a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' })
    ),
    driveFolderId.length > 14 ? `${driveFolderId.slice(0, 8)}…${driveFolderId.slice(-4)}` : driveFolderId || '—',
  );


  return React.createElement(
    React.Fragment,
    null,

    // Toolbar
    React.createElement(
      'div',
      { className: 'flex items-center justify-between mb-4 flex-wrap gap-2' },
      React.createElement(
        'h2',
        { className: 'text-3xl font-bold text-gray-100' },
        'My Library'
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2 flex-wrap' },
        React.createElement(
          'span',
          { className: 'text-sm text-gray-500 font-medium bg-gray-800 px-3 py-1 rounded-full border border-gray-700' },
          hasActiveSearch ? `${filteredGridCount} / ${totalGridCount}` : totalGridCount,
          ' ',
          totalGridCount === 1 ? 'Item' : 'Items'
        ),

        folderBadge,

        // Add Content: editors get full menu; viewers may create desks only
        showLibraryAddMenu && React.createElement(AddContentDropdown, {
          onNewNote: isEditor ? onOpenNewNote : undefined,
          onAddYoutube: isEditor ? onOpenYoutube : undefined,
          onAddChannel: isEditor ? onOpenChannel : undefined,
          onAddFile: isEditor ? onOpenFile : undefined,
          onAddUrl: isEditor ? onOpenUrl : undefined,
          onAddImage: isEditor ? onOpenImage : undefined,
          onAddDesk: onAddDesk ? () => {
            const name = window.prompt('Desk name:', 'New Desk');
            if (name && name.trim()) onAddDesk(name.trim());
          } : undefined,
        }),

      )
    ),

    // Search bar (with type filters + tag suggestions inside dropdown)
    React.createElement(
      'div',
      { className: 'mb-4' },
      React.createElement(
        'div',
        { className: 'relative z-30' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none z-10', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        ),
        React.createElement('input', {
          ref: searchInputRef,
          type: 'search',
          autoComplete: 'off',
          'aria-autocomplete': 'list',
          'aria-expanded': searchInputFocused,
          'aria-controls': 'library-search-suggestions',
          role: 'combobox',
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          onFocus: () => setSearchInputFocused(true),
          onBlur: () => setSearchInputFocused(false),
          onKeyDown: handleSearchKeyDown,
          placeholder: 'Search name, tags, or filter by type…',
          className: 'w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors',
        }),
        (searchQuery || activeFilters.size > 0) && React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => { setSearchQuery(''); setActiveFilters(new Set()); setSearchSuggestIndex(-1); },
            className: 'absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors z-10',
            title: 'Clear search and filters',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        ),
        // Dropdown: always shown when focused
        searchInputFocused && React.createElement(
          'div',
          {
            id: 'library-search-suggestions',
            className: 'absolute left-0 right-0 top-full mt-1 rounded-xl border border-gray-700 bg-gray-800 shadow-xl shadow-black/40 z-50 overflow-hidden',
          },
          // Type filter tabs row
          React.createElement(
            'div',
            { className: 'flex items-center gap-1.5 flex-wrap px-3 py-2.5 border-b border-gray-700/60' },
            [
              { key: 'books',    label: 'Books',    activeClass: 'bg-indigo-600 border-indigo-500 text-white' },
              { key: 'notes',    label: 'Notes',    activeClass: 'bg-emerald-600 border-emerald-500 text-white' },
              { key: 'videos',   label: 'Videos',   activeClass: 'bg-red-600 border-red-500 text-white' },
              { key: 'url',      label: 'URLs',     activeClass: 'bg-cyan-700 border-cyan-600 text-white' },
              { key: 'images',   label: 'Images',   activeClass: 'bg-teal-600 border-teal-500 text-white' },
              { key: 'channels', label: 'Channels', activeClass: 'bg-red-900 border-red-800 text-white' },
              { key: 'desks',    label: 'Desks',    activeClass: 'bg-violet-700 border-violet-600 text-white' },
            ].map(({ key, label, activeClass }) =>
              React.createElement(
                'button',
                {
                  key,
                  type: 'button',
                  onMouseDown: (e) => { e.preventDefault(); toggleFilter(key); },
                  className: 'px-2.5 py-0.5 rounded-md text-xs font-semibold border transition-all ' + (
                    activeFilters.has(key)
                      ? activeClass
                      : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                  ),
                },
                label
              )
            )
          ),
          // Suggestions list (only when there are matches)
          searchSuggestions.length > 0 && React.createElement(
            'ul',
            { role: 'listbox', className: 'max-h-52 overflow-y-auto py-1' },
            searchSuggestions.map((row, idx) => {
              const catLabel =
                row.category === 'item'    ? 'Item'
                : row.category === 'channel' ? 'Channel'
                : row.category === 'share'   ? 'Share'
                : row.category === 'share-tag' ? 'Share tag'
                : 'Tag';
              const active = searchSuggestIndex === idx;
              return React.createElement(
                'li',
                {
                  key: `suggest-${row.kind}-${row.category}-${row.value}-${idx}`,
                  role: 'option',
                  'aria-selected': active,
                },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    id: `library-search-opt-${idx}`,
                    className:
                      'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ' +
                      (active ? 'bg-indigo-900/50 text-indigo-100' : 'text-gray-200 hover:bg-gray-700/80'),
                    onMouseDown: (e) => { e.preventDefault(); applySearchSuggestion(row); },
                    onMouseEnter: () => setSearchSuggestIndex(idx),
                  },
                  React.createElement(
                    'span',
                    {
                      className:
                        'shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ' +
                        (row.kind === 'tag' ? 'bg-amber-900/50 text-amber-200/90' : 'bg-gray-600/80 text-gray-300'),
                    },
                    catLabel
                  ),
                  React.createElement('span', { className: 'min-w-0 flex-1 truncate', title: row.value }, row.label)
                )
              );
            })
          )
        )
      ),
      // Active filter pills shown below input when not focused
      activeFilters.size > 0 && React.createElement(
        'div',
        { className: 'flex items-center gap-1.5 flex-wrap mt-1.5' },
        [...activeFilters].map((key) => {
          const labels = { books: 'Books', notes: 'Notes', videos: 'Videos', url: 'URLs', images: 'Images', channels: 'Channels', desks: 'Desks' };
          const colors = {
            books: 'bg-indigo-900/50 text-indigo-300 border-indigo-700/50',
            notes: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
            videos: 'bg-red-900/50 text-red-300 border-red-700/50',
            url: 'bg-cyan-900/50 text-cyan-300 border-cyan-700/50',
            images: 'bg-teal-900/50 text-teal-300 border-teal-700/50',
            channels: 'bg-red-900/60 text-red-200 border-red-800/50',
            desks: 'bg-violet-900/50 text-violet-300 border-violet-700/50',
          };
          return React.createElement(
            'button',
            {
              key,
              type: 'button',
              onClick: () => toggleFilter(key),
              className: `flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${colors[key] || 'bg-gray-700 text-gray-300 border-gray-600'}`,
              title: `Remove ${labels[key]} filter`,
            },
            labels[key] || key,
            React.createElement('span', { className: 'opacity-60 text-[10px]' }, ' ×')
          );
        })
      )
    ),

    // Sync progress banner — visible while sync is running
    isSyncing && React.createElement(
      'div',
      { className: 'mb-4 px-4 py-2 rounded-xl text-sm flex items-center gap-3 bg-teal-900/30 text-teal-300 border border-teal-800/40' },
      React.createElement('div', { className: 'h-3.5 w-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin flex-shrink-0' }),
      syncProgress || 'Syncing…',
    ),

    // Sync result banner (covers both backup and sync phases)
    !isSyncing && syncResult && React.createElement(
      'div',
      {
        className: `mb-4 px-4 py-2 rounded-xl text-sm flex items-center justify-between ${syncResult.error ? 'bg-red-900/30 text-red-300 border border-red-800/40' : syncResult.failed > 0 ? 'bg-amber-900/30 text-amber-300 border border-amber-800/40' : 'bg-teal-900/30 text-teal-300 border border-teal-800/40'}`,
      },
      syncResult.error
        ? `Sync failed: ${syncResult.error}`
        : [
            syncResult.sharedFor && `Account ${syncResult.sharedFor}`,
            syncResult.backed > 0 && `${syncResult.backed} backed up`,
            syncResult.backupFailed > 0 && `${syncResult.backupFailed} backup failed`,
            `${syncResult.added} added`,
            `${syncResult.updated} updated`,
            `${syncResult.skipped} unchanged`,
            syncResult.removed > 0 && `${syncResult.removed} removed (share revoked)`,
            syncResult.failed > 0 && `${syncResult.failed} inaccessible (owner may need to re-apply share permissions)`,
          ].filter(Boolean).join(', '),
      React.createElement(
        'button',
        { onClick: () => setSyncResult(null), className: 'ml-4 text-current opacity-60 hover:opacity-100 text-lg leading-none' },
        '×'
      )
    ),


    // Unified grid: display order follows selected policy, 20 per page
    sortedLibraryRows.length > 0
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            {
              className:
                'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6',
            },
            libraryPageRows.map((row) => {
              if (row.kind === 'item') {
                const video = row.data;
                return React.createElement(DataTile, {
                  key: libraryItemKey(video),
                  tileType: 'item',
                  item: video,
                  onSelect: onSelectItem,
                  onDelete: handleDeleteItemRequest,
                  onUpload: handleUpload,
                  onSetNoteCoverImage: onSetNoteCoverImage
                    ? (v, file) => onSetNoteCoverImage(v.id, file, v.idbStore)
                    : undefined,
                  onSetCoverFromLibrary: isEditor ? (v) => setCoverPickerTarget(v) : undefined,
                  uploadStatus: uploadStatuses[libraryItemKey(video)] ?? null,
                  readOnly: !isEditor,
                  onSetTags: (v, tags) => setRecordTags(v.id, v.idbStore, tags),
                  onSetSharedWith: (v, emails) => handleSetSharedWith(v, v.idbStore, emails),
                  canShare: canEditShareForRecord(video),
                  shareableEmails: shareableUserEmails,
                  onRename: (v, name) => renameItem(v.id, v.idbStore, name),
                  availableTags,
                  itemDownloadProgress,
                });
              }
              if (row.kind === 'channel') {
                const ch = row.data;
                return React.createElement(DataTile, {
                  key: `ch-${ch.id}`,
                  tileType: 'channel',
                  channel: ch,
                  onSelect: onSelectChannel,
                  onDelete: handleDeleteChannelRequest,
                  onUpload: handleChannelUpload,
                  uploadStatus: uploadStatuses[channelUploadKey(ch)] ?? null,
                  readOnly: !isEditor,
                  onSetTags: (c, tags) => setRecordTags(c.id, 'channels', tags),
                  onSetSharedWith: (c, emails) => handleSetSharedWith(c, 'channels', emails),
                  canShare: canEditShareForRecord(ch),
                  shareableEmails: shareableUserEmails,
                  onRename: (c, name) => renameItem(c.id, 'channels', name),
                  availableTags,
                });
              }
              if (row.kind === 'desk') {
                const d = row.data;
                const deskIsViewerOwned = !d.ownerEmail ||
                  String(d.ownerEmail).trim().toLowerCase() === normalizedUserEmail;
                const canDeleteDesk = isEditor
                  ? !!onRequestDeleteDesk
                  : (userType === 'viewer' && deskIsViewerOwned && !!onRequestDeleteDesk);
                return React.createElement(DataTile, {
                  key: `desk-${d.id}`,
                  tileType: 'desk',
                  desk: d,
                  onSelect: onSelectDesk,
                  onDelete: canDeleteDesk ? handleDeleteDeskRequest : undefined,
                  onRename: isEditor ? (desk, name) => renameItem(desk.id, 'desks', name) : undefined,
                  readOnly: !isEditor && !deskIsViewerOwned,
                  canShare: isEditor && canEditShareForRecord(d),
                  shareableEmails: shareableUserEmails,
                  onSetSharedWith: isEditor ? (desk, emails) => handleSetSharedWith(desk, 'desks', emails) : undefined,
                  onSetCoverImage: isEditor && onSetNoteCoverImage
                    ? (desk, file) => onSetNoteCoverImage(desk.id, file, 'desks')
                    : undefined,
                  onSetCoverFromLibrary: isEditor ? (dk) => setCoverPickerTarget({ ...dk, _storeName: 'desks' }) : undefined,
                });
              }
              return null;
            })
          ),
          libraryTotalPages > 1 &&
            React.createElement(
              'div',
              { className: 'flex flex-col sm:flex-row items-center justify-center gap-4 mt-10 pt-6 border-t border-gray-800' },
              React.createElement(
                'p',
                { className: 'text-sm text-gray-400 order-2 sm:order-1' },
                'Showing ',
                libraryPageIndex * LIBRARY_PAGE_SIZE + 1,
                '\u2013',
                Math.min((libraryPageIndex + 1) * LIBRARY_PAGE_SIZE, sortedLibraryRows.length),
                ' of ',
                sortedLibraryRows.length
              ),
              React.createElement(
                'div',
                { className: 'flex items-center gap-2 order-1 sm:order-2' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setLibraryPageIndex((p) => Math.max(0, p - 1)),
                    disabled: libraryPageIndex <= 0,
                    className:
                      'px-4 py-2 rounded-lg text-sm font-medium border transition-colors ' +
                      (libraryPageIndex <= 0
                        ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                        : 'border-gray-600 text-gray-200 hover:bg-gray-800'),
                  },
                  'Previous'
                ),
                React.createElement(
                  'span',
                  { className: 'text-sm text-gray-500 px-2 min-w-[5rem] text-center' },
                  'Page ',
                  libraryPageIndex + 1,
                  ' / ',
                  libraryTotalPages
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setLibraryPageIndex((p) => Math.min(libraryTotalPages - 1, p + 1)),
                    disabled: libraryPageIndex >= libraryTotalPages - 1,
                    className:
                      'px-4 py-2 rounded-lg text-sm font-medium border transition-colors ' +
                      (libraryPageIndex >= libraryTotalPages - 1
                        ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                        : 'border-gray-600 text-gray-200 hover:bg-gray-800'),
                  },
                  'Next'
                )
              )
            )
        )
      : hasActiveSearch
        ? React.createElement(
            'div',
            { className: 'text-center py-16 px-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20' },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-12 w-12 text-gray-600 mx-auto mb-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
            ),
            React.createElement('h3', { className: 'text-xl font-semibold text-gray-400' }, 'No results found'),
            React.createElement(
              'p',
              { className: 'text-gray-500 mt-2 max-w-sm mx-auto' },
              query ? `No items matching "${searchQuery.trim()}"` : 'No items match the selected filters'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setSearchQuery(''); setActiveFilters(new Set()); },
                className: 'mt-4 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors',
              },
              'Clear search'
            )
          )
        : totalGridCount === 0
          ? React.createElement(
              'div',
              { className: 'text-center py-20 px-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20' },
              React.createElement(
                'div',
                { className: 'bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700' },
                React.createElement(BookIcon, { className: 'h-8 w-8 text-gray-600' })
              ),
              React.createElement('h3', { className: 'text-xl font-semibold text-gray-400' }, 'Library is Empty'),
              React.createElement(
                'p',
                { className: 'text-gray-500 mt-2 max-w-sm mx-auto' },
                'Click "Add File" to import an EPUB, PDF, TXT, or Markdown file, or "Add YouTube" to save a video link.'
              ),
              isEditor && React.createElement(
                'button',
                {
                  onClick: onOpenFile,
                  className: 'mt-6 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl transition-all'
                },
                React.createElement(BookIcon, { className: 'h-5 w-5' }),
                'Add Your First File'
              )
            )
          : null,

    // System settings modal — portal so it renders above any view (library/desk/explorer)
    isSystemSettingsOpen && createPortal(React.createElement(
      'div',
      {
        className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-[110] p-4',
        onClick: (e) => { if (e.target === e.currentTarget) setIsSystemSettingsOpen(false); },
      },
      React.createElement(
        'div',
        { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-700 overflow-hidden flex flex-col max-h-[90vh]' },

        // Header
        React.createElement(
          'div',
          { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
          React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'System Settings'),
          React.createElement(
            'button',
            {
              onClick: () => setIsSystemSettingsOpen(false),
              className: 'text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-gray-700 transition-colors',
            },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
            )
          )
        ),

        // Body
        React.createElement(
          'div',
          { className: 'p-6 space-y-5 overflow-y-auto' },

          // Section 1: Google API (build-time env)
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Google API'),
            React.createElement(
              'div',
              { className: 'bg-gray-900 rounded-xl px-4 py-3' },
              React.createElement('p', { className: 'text-sm font-medium text-gray-200' }, 'Client ID & API key'),
              React.createElement(
                'p',
                { className: 'text-xs text-gray-500 mt-1 leading-relaxed' },
                'Set ',
                React.createElement('code', { className: 'text-gray-400' }, 'VITE_CLIENT_ID'),
                ' and Google API access (',
                React.createElement('code', { className: 'text-gray-400' }, 'VITE_API_KEY'),
                ' or Netlify proxy; see README) in your environment (',
                React.createElement('code', { className: 'text-gray-400' }, '.env'),
                ' locally, Netlify site settings in production).',
              ),
            ),
          ),

          // Section 1b: Drive folder (localStorage)
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Drive folder'),
            React.createElement(
              'div',
              { className: 'space-y-2' },
              React.createElement('input', {
                type: 'text',
                value: driveFolderDraft,
                onChange: (e) => setDriveFolderDraft(e.target.value),
                placeholder: 'Folder ID or Drive URL',
                className:
                  'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono',
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    const parsed = parseDriveFolderIdInput(driveFolderDraft);
                    if (!parsed) {
                      window.alert('Enter a valid folder ID or paste the folder URL from Google Drive.');
                      return;
                    }
                    setDriveFolderId(parsed);
                    onDriveCredentialsChanged?.();
                    setIsSystemSettingsOpen(false);
                  },
                  className: 'w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium',
                },
                'Save folder',
              ),
              React.createElement(
                'p',
                { className: 'text-xs text-gray-500' },
                'Stored in this browser as ',
                React.createElement('code', { className: 'text-gray-400' }, 'infodepo_drive_folder_id'),
                '. Changing it may require signing in to Google again from the setup screen.',
              ),
            ),
          ),

          // Section 1c: Library display order
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Library display'),
            React.createElement(
              'div',
              { className: 'bg-gray-900 rounded-xl px-4 py-3 space-y-2' },
              React.createElement('p', { className: 'text-sm font-medium text-gray-200' }, 'Item order policy'),
              React.createElement(
                'select',
                {
                  value: libraryDisplayPolicy,
                  onChange: (e) => {
                    const next = e.target.value;
                    setLibraryDisplayPolicy(next);
                    writeLibraryDisplayPolicy(next);
                    setLibraryPageIndex(0);
                  },
                  className:
                    'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500',
                },
                React.createElement('option', { value: LIBRARY_DISPLAY_POLICIES.random }, 'Random (default)'),
                React.createElement('option', { value: LIBRARY_DISPLAY_POLICIES.modifiedTimeBased }, 'Modified time (newest first)')
              ),
              React.createElement(
                'p',
                { className: 'text-xs text-gray-500' },
                'Saved in this browser as ',
                React.createElement('code', { className: 'text-gray-400' }, 'infodepo_library_display_policy'),
                '.'
              )
            )
          ),

          // Section 2: Google Account
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Google Account'),
            React.createElement(
              'div',
              { className: 'flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3' },
              React.createElement(
                'div',
                null,
                React.createElement('p', { className: 'text-sm font-medium text-gray-200' }, 'Sign out'),
                React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, 'Revokes the current OAuth token')
              ),
              React.createElement(
                'button',
                {
                  onClick: () => {
                    handleSignOutGoogle();
                    setIsSystemSettingsOpen(false);
                  },
                  className: 'text-sm text-orange-400 hover:text-orange-300 px-3 py-1.5 rounded-lg hover:bg-orange-900/20 transition-colors',
                  title: 'Sign out of Google and revoke current OAuth token',
                },
                'Sign Out'
              )
            )
          ),

          // Section 3: Library data
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Library Data'),
            React.createElement(
              'div',
              { className: 'flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3' },
              React.createElement(
                'div',
                null,
                React.createElement('p', { className: 'text-sm font-medium text-gray-200' }, 'Clear all content'),
                React.createElement(
                  'p',
                  { className: 'text-xs text-gray-500 mt-0.5' },
                  `${totalGridCount} item${totalGridCount === 1 ? '' : 's'} stored locally`
                )
              ),
              React.createElement(
                'button',
                {
                  onClick: () => {
                    setIsSystemSettingsOpen(false);
                    handleConfirmClear();
                  },
                  className: 'text-sm text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-900/20 transition-colors',
                  title: 'Delete database and reinitialize',
                },
                'Clear All'
              )
            )
          ),

          // Section 4: Storage usage & limit
          React.createElement(
            'div',
            { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, 'Storage'),
            React.createElement(
              'div',
              { className: 'bg-gray-900 rounded-xl px-4 py-3 space-y-3' },
              storageUsed != null && React.createElement(
                'div',
                { className: 'space-y-1' },
                React.createElement(
                  'div',
                  { className: 'w-full bg-gray-700 rounded-full h-2' },
                  React.createElement('div', {
                    className: 'bg-indigo-500 h-2 rounded-full transition-all',
                    style: { width: `${Math.min(100, (storageUsed / (storageLimitDraft * 1024 ** 3)) * 100).toFixed(1)}%` },
                  })
                ),
                React.createElement(
                  'p',
                  { className: 'text-xs text-gray-400' },
                  `${formatBytes(storageUsed)} used of ${storageLimitDraft} GB`
                )
              ),
              React.createElement('p', { className: 'text-sm font-medium text-gray-200' }, 'Storage limit (GB)'),
              React.createElement(
                'div',
                { className: 'flex gap-2' },
                React.createElement('input', {
                  type: 'number',
                  min: 1,
                  value: storageLimitDraft,
                  onChange: (e) => setStorageLimitDraft(Math.max(1, Number(e.target.value))),
                  className: 'w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500',
                }),
                React.createElement(
                  'button',
                  {
                    onClick: () => saveSyncSettings({ maxStorageGB: storageLimitDraft }),
                    className: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium',
                  },
                  'Save'
                )
              ),
              React.createElement(
                'p',
                { className: 'text-xs text-gray-500' },
                'Oldest unvisited items (> 1 KB) are auto-cleared when over limit. Item metadata is kept.'
              )
            )
          )
        )
      )
    ), document.body),

    coverPickerTarget && React.createElement(CoverImagePickerModal, {
      images: (items || []).filter((i) => String(i.type || '').startsWith('image/') && i.data instanceof Blob),
      onClose: () => setCoverPickerTarget(null),
      onSelect: async (imageItem) => {
        const target = coverPickerTarget;
        setCoverPickerTarget(null);
        if (!onSetNoteCoverImage || !target) return;
        try {
          const file = new File([imageItem.data], imageItem.name, { type: imageItem.type });
          const storeName = target._storeName || target.idbStore || 'notes';
          await onSetNoteCoverImage(target.id, file, storeName);
        } catch (err) {
          window.alert(err?.message || 'Could not set cover image.');
        }
      },
    }),

    pendingDelete &&
      React.createElement(DeleteContentModal, {
        title:
          pendingDelete.kind === 'item'
            ? 'Remove item'
            : 'Remove channel',
        name:
          pendingDelete.kind === 'item'
            ? pendingDelete.item.name
            : pendingDelete.channel.name || pendingDelete.channel.handle || 'Channel',
        hasDriveCopy:
          pendingDelete.kind === 'item'
            ? recordHasDriveCopy(pendingDelete.item)
            : recordHasDriveCopy(pendingDelete.channel),
        canDeleteFromDrive: hasCredentials,
        onRemoveLocal: runPendingDeleteLocal,
        onRemoveFromDrive: runPendingDeleteWithDrive,
        onClose: closePendingDelete,
      })
  );
};
