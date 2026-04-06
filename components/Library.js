
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { DataTile } from './DataTile.js';
import { BookIcon } from './icons/BookIcon.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from '../utils/driveCredentials.js';
import { getDriveFolderId, setDriveFolderId, parseDriveFolderIdInput } from '../utils/driveFolderStorage.js';
import {
  getStoredAccessToken,
  saveStoredAccessToken,
  removeStoredAccessToken,
  clearAllStoredAccessTokens,
  getAllStoredAccessTokens,
} from '../utils/driveOAuthStorage.js';
import { NewNoteModal } from './NewNoteModal.js';
import { NewYoutubeModal } from './NewYoutubeModal.js';
import { NewChannelModal } from './NewChannelModal.js';
import { syncDriveToLocal, backupAllToGDrive, syncSharedFilesByDriveId } from '../utils/driveSync.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';
import { fetchGoogleUserEmail } from '../utils/googleUser.js';
import { normalizeTag } from '../utils/tagUtils.js';
import { OWNER_DRIVE_SCOPE } from '../utils/driveScopes.js';
import { SharesEditorModal } from './SharesEditorModal.js';
import { DeleteContentModal } from './DeleteContentModal.js';
import { uploadSharesJsonToDrive, fetchSharesJsonByFileId } from '../utils/sharesDriveFile.js';
import { applyShareRecordsToDriveFiles } from '../utils/driveSharePermissions.js';
import { payloadToClientRecord, normalizeExplicitRefs } from '../utils/sharesDriveJson.js';
import { getOwnerDriveAccessToken, invalidateDriveAccessTokenCache } from '../utils/driveAccessToken.js';
import { deleteDriveFilesForMergedItem, deleteDriveFilesForChannel } from '../utils/deleteLibraryContentOnDrive.js';

/** Must match `CHANNEL_JSON_MARKER` in `utils/driveSync.js` for Drive backup/sync. */
const CHANNEL_JSON_MARKER = 'infodepo-channel';

const channelUploadKey = (ch) => `channel-${ch?.id}`;

const SEARCH_SUGGEST_MAX = 15;

export const Library = ({
  items, channels, shares,
  onSelectItem, onSelectChannel, onAddItem, onDeleteItem, onClearLibrary,
  onSetDriveId, onSetNoteFolderData, onGetAllImages, getImagesForNote,
  onAddChannel, onDeleteChannel,
  upsertDriveChannel,
  getBookByDriveId, getBookByName, upsertDriveBook,
  getShareByDriveFileId, upsertDriveShare,
  getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
  setRecordTags,
  getMergedLibraryItems,
  getSharesList,
  addShare,
  updateShare,
  deleteShare,
  onGoogleUserEmail,
  onDriveCredentialsChanged,
}) => {
  const fileInputRef      = useRef(null);
  const searchInputRef    = useRef(null);
  const uploadTokenRef    = useRef(null);
  const lastScopeRef      = useRef('');
  const oauthClientModeRef = useRef(null);
  const reapplyShareAclTimerRef = useRef(null);
  const [uploadStatuses,   setUploadStatuses]   = useState({});
  const credentials = getDriveCredentials();
  const driveFolderId = getDriveFolderId();
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = useState(false);
  const [driveFolderDraft, setDriveFolderDraft] = useState('');
  const [isNewNoteOpen,    setIsNewNoteOpen]    = useState(false);
  const [isYoutubeOpen,    setIsYoutubeOpen]    = useState(false);
  const [isChannelOpen,    setIsChannelOpen]    = useState(false);
  const [isAddMenuOpen,    setIsAddMenuOpen]    = useState(false);
  const [activeShare,      setActiveShare]      = useState(null);
  const [activeShareFilter, setActiveShareFilter] = useState(null);
  const [availableTags,    setAvailableTags]    = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);

  // Search state
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchSuggestIndex, setSearchSuggestIndex] = useState(-1);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [activeFilters,    setActiveFilters]    = useState(new Set());

  // Sync + Backup state (combined operation)
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [syncResult,  setSyncResult]  = useState(null);
  const [syncProgress, setSyncProgress] = useState('');

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
    if (isSystemSettingsOpen) setDriveFolderDraft(getDriveFolderId());
  }, [isSystemSettingsOpen]);

  // Tags for card dropdowns: union of item and channel tags
  useEffect(() => {
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
    setAvailableTags([...fromAll].sort());
  }, [items, channels]);

  const pickableWithDriveId = useMemo(() => {
    const out = [];
    for (const it of items) {
      if (it.driveId) {
        out.push({
          key: libraryItemKey(it),
          label: it.name || 'Untitled',
          driveId: it.driveId,
        });
      }
    }
    for (const ch of channels || []) {
      if (ch.driveId) {
        out.push({
          key: `channel-${ch.id}`,
          label: ch.name || ch.handle || 'Channel',
          driveId: ch.driveId,
        });
      }
    }
    return out;
  }, [items, channels]);

  const openNewShare = async () => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `share-${Date.now()}`;
    const row = {
      id,
      driveFileName: `share-${Date.now()}.share.json`,
      driveFileId: '',
      recipients: [],
      includeTags: [],
      explicitRefs: [],
      role: 'owner',
      updatedAt: new Date().toISOString(),
    };
    try {
      await addShare(row);
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not create share.');
      return;
    }
    setActiveShare(row);
  };

  const parseDriveFileIdFromInput = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const fileD = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileD) return fileD[1];
    const openId = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (openId) return openId[1];
    if (/^[a-zA-Z0-9_-]+$/.test(s) && s.length >= 10) return s;
    return s;
  };

  const openLinkShare = async () => {
    const raw = window.prompt(
      'Paste a Google Drive link or file ID for the share JSON:\n\n' +
      'Examples:\n' +
      '  https://drive.google.com/file/d/1BxiMVs…/view\n' +
      '  https://drive.google.com/open?id=1BxiMVs…\n' +
      '  1BxiMVs…  (raw file ID)'
    );
    if (!raw || !String(raw).trim()) return;
    const fid = parseDriveFileIdFromInput(raw);
    if (!fid) {
      window.alert('Could not extract a file ID from that input.');
      return;
    }
    setIsAddMenuOpen(false);
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
      const payload = await fetchSharesJsonByFileId(token, fid);
      if (!payload) {
        window.alert('Could not read or parse that file.');
        return;
      }
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `recv-${Date.now()}`;
      const rec = payloadToClientRecord(id, payload, 'receiver', String(fid).trim());
      await addShare(rec);

      const driveIds = new Set(
        (rec.explicitRefs || []).map((r) => String(r.driveId || '').trim()).filter(Boolean)
      );
      if (driveIds.size > 0) {
        setIsSyncing(true);
        setSyncProgress('Downloading shared content…');
        try {
          const result = await syncSharedFilesByDriveId({
            accessToken: token,
            driveIds,
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
            onProgress: setSyncProgress,
          });
          setSyncResult({
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
            backed: 0,
            backupFailed: 0,
            sharedFor: '',
          });
        } catch (syncErr) {
          console.warn('[InfoDepo] share content sync failed:', syncErr);
          setSyncResult({ error: `Shared content sync failed: ${syncErr.message}` });
        } finally {
          setIsSyncing(false);
          setSyncProgress('');
        }
      }

      setActiveShareFilter(rec);
    } catch (e) {
      window.alert(e?.message || String(e));
    }
  };

  /** Resolve includeTags → items/channels with driveId, merge into explicitRefs (dedup by driveId). */
  const resolveTagsIntoExplicitRefs = (recIncludeTags, recExplicitRefs) => {
    const tagSet = new Set((recIncludeTags || []).map((t) => normalizeTag(t)).filter(Boolean));
    if (tagSet.size === 0) return normalizeExplicitRefs(recExplicitRefs);

    const merged = new Map();
    for (const ref of normalizeExplicitRefs(recExplicitRefs)) {
      merged.set(ref.driveId, ref);
    }
    for (const it of items) {
      if (!it.driveId) continue;
      const itTags = (it.tags || []).map((t) => normalizeTag(t));
      if (itTags.some((t) => tagSet.has(t))) {
        if (!merged.has(it.driveId)) {
          merged.set(it.driveId, { name: it.name || 'Untitled', driveId: it.driveId });
        }
      }
    }
    for (const ch of channels || []) {
      if (!ch.driveId) continue;
      const chTags = (ch.tags || []).map((t) => normalizeTag(t));
      if (chTags.some((t) => tagSet.has(t))) {
        if (!merged.has(ch.driveId)) {
          merged.set(ch.driveId, { name: ch.name || ch.handle || 'Channel', driveId: ch.driveId });
        }
      }
    }
    return [...merged.values()];
  };

  const handleOwnerSaveShare = async (rec) => {
    if (!hasCredentials) throw new Error('Configure Drive folder and credentials first.');
    const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
    const prev = rec.driveFileId ? await fetchSharesJsonByFileId(token, rec.driveFileId) : null;
    const mergedItems = await getMergedLibraryItems();
    const images = onGetAllImages ? await onGetAllImages() : [];
    const resolvedExplicitRefs = resolveTagsIntoExplicitRefs(rec.includeTags, rec.explicitRefs);
    const enrichedRec = { ...rec, explicitRefs: resolvedExplicitRefs };
    const result = await uploadSharesJsonToDrive({
      accessToken: token,
      folderId: driveFolderId,
      record: enrichedRec,
      existingFileId: rec.driveFileId || undefined,
    });
    await updateShare(rec.id, {
      driveFileId: result.id,
      driveFileName: rec.driveFileName,
      recipients: rec.recipients,
      includeTags: rec.includeTags,
      explicitRefs: resolvedExplicitRefs,
      updatedAt: rec.updatedAt,
    });
    const owners = (await getSharesList()).filter((s) => s.role !== 'receiver');
    await applyShareRecordsToDriveFiles({
      accessToken: token,
      items: mergedItems,
      images,
      channels: channels || [],
      shareRecords: owners,
      previousSharePayloads: prev ? [prev] : [],
      onProgress: () => {},
    });
  };

  const handleRefreshReceiverShare = async () => {
    if (!activeShare?.driveFileId) return;
    const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
    const payload = await fetchSharesJsonByFileId(token, activeShare.driveFileId);
    if (!payload) throw new Error('Could not refresh.');
    await updateShare(activeShare.id, {
      driveFileName: payload.driveFileName,
      recipients: payload.recipients,
      includeTags: payload.includeTags,
      explicitRefs: normalizeExplicitRefs(payload.explicitRefs),
      updatedAt: payload.updatedAt,
    });
    const row = (await getSharesList()).find((s) => s.id === activeShare.id);
    if (row) setActiveShare(row);
  };

  const handleOpenReceiverShare = async (rec) => {
    setActiveShareFilter(rec);
    if (!rec.driveFileId) return;
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
      const payload = await fetchSharesJsonByFileId(token, rec.driveFileId);
      if (payload) {
        const updated = normalizeExplicitRefs(payload.explicitRefs);
        await updateShare(rec.id, {
          driveFileName: payload.driveFileName,
          recipients: payload.recipients,
          includeTags: payload.includeTags,
          explicitRefs: updated,
          updatedAt: payload.updatedAt,
        });
        const freshRec = (await getSharesList()).find((s) => s.id === rec.id) || rec;
        setActiveShareFilter(freshRec);

        const driveIds = new Set(
          (updated || []).map((r) => String(r.driveId || '').trim()).filter(Boolean)
        );
        if (driveIds.size > 0) {
          setIsSyncing(true);
          setSyncProgress('Downloading shared content…');
          const result = await syncSharedFilesByDriveId({
            accessToken: token,
            driveIds,
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
            onProgress: setSyncProgress,
          });
          setSyncResult({
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
            backed: 0,
            backupFailed: 0,
          });
          setIsSyncing(false);
          setSyncProgress('');
          const refreshed = (await getSharesList()).find((s) => s.id === rec.id) || rec;
          setActiveShareFilter(refreshed);
        }
      }
    } catch (e) {
      console.warn('[InfoDepo] receiver share open sync:', e);
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  // Clear in-memory token when client ID changes.
  useEffect(() => {
    const clientId = credentials.clientId;
    if (oauthClientModeRef.current === null) {
      oauthClientModeRef.current = clientId;
    } else if (oauthClientModeRef.current !== clientId) {
      clearAllStoredAccessTokens();
      oauthClientModeRef.current = clientId;
    }
    uploadTokenRef.current = null;
    lastScopeRef.current = '';
    invalidateDriveAccessTokenCache();
  }, [credentials.clientId]);

  const setStatus = (key, status) =>
    setUploadStatuses(prev => ({ ...prev, [key]: status }));

  const getDriveTokenForScope = (scope) =>
    new Promise((resolve, reject) => {
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google API not loaded'));
        return;
      }
      if (lastScopeRef.current !== scope) {
        uploadTokenRef.current = null;
        lastScopeRef.current = scope;
      }
      if (!uploadTokenRef.current) {
        const fromStorage = getStoredAccessToken(credentials.clientId, scope);
        if (fromStorage) uploadTokenRef.current = fromStorage;
      }
      if (uploadTokenRef.current) {
        resolve(uploadTokenRef.current);
        return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: credentials.clientId,
        scope,
        callback: (res) => {
          if (res.error) { reject(new Error(res.error_description || res.error)); return; }
          uploadTokenRef.current = res.access_token;
          saveStoredAccessToken(
            credentials.clientId,
            scope,
            res.access_token,
            res.expires_in,
          );
          resolve(res.access_token);
        },
      });
      client.requestAccessToken({ prompt: '' });
    });

  /** Re-resolve tags → explicitRefs for all owner shares, persist, re-upload JSON, then reapply Drive ACLs. */
  const scheduleReapplyShareAclsAfterTagChange = () => {
    if (!hasCredentials) return;
    if (reapplyShareAclTimerRef.current) clearTimeout(reapplyShareAclTimerRef.current);
    reapplyShareAclTimerRef.current = setTimeout(async () => {
      reapplyShareAclTimerRef.current = null;
      try {
        let owners = (await getSharesList()).filter((s) => s.role !== 'receiver');
        if (owners.length === 0) return;
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
        const mergedItems = await getMergedLibraryItems();
        const images = onGetAllImages ? await onGetAllImages() : [];

        for (const o of owners) {
          const resolved = resolveTagsIntoExplicitRefs(o.includeTags, o.explicitRefs);
          const changed = JSON.stringify(resolved) !== JSON.stringify(normalizeExplicitRefs(o.explicitRefs));
          if (!changed) continue;
          await updateShare(o.id, { explicitRefs: resolved, updatedAt: new Date().toISOString() });
          if (o.driveFileId) {
            await uploadSharesJsonToDrive({
              accessToken: token,
              folderId: driveFolderId,
              record: { ...o, explicitRefs: resolved },
              existingFileId: o.driveFileId,
            });
          }
        }

        owners = (await getSharesList()).filter((s) => s.role !== 'receiver');
        const previousSharePayloads = await Promise.all(
          owners.map((o) =>
            o.driveFileId ? fetchSharesJsonByFileId(token, o.driveFileId) : Promise.resolve(null)
          )
        );
        await applyShareRecordsToDriveFiles({
          accessToken: token,
          items: mergedItems,
          images,
          channels: channels || [],
          shareRecords: owners,
          previousSharePayloads,
          onProgress: () => {},
        });
      } catch (e) {
        console.warn('[InfoDepo] reapply share ACLs after tag/upload change:', e);
      }
    }, 450);
  };

  useEffect(
    () => () => {
      if (reapplyShareAclTimerRef.current) clearTimeout(reapplyShareAclTimerRef.current);
    },
    []
  );

  const setRecordTagsAndReapplyShares = async (id, storeName, tags) => {
    await setRecordTags(id, storeName, tags);
    scheduleReapplyShareAclsAfterTagChange();
  };

  useEffect(() => {
    if (!onGoogleUserEmail) return;
    if (!hasCredentials) {
      onGoogleUserEmail(null);
      return;
    }
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

  const handleUpload = async (video) => {
    const uKey = libraryItemKey(video);
    setStatus(uKey, 'uploading');
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);

      // YouTube links: upload as .json so Drive can display the content
      const isYoutube = video.type === 'application/x-youtube';
      const driveName = isYoutube ? video.name.replace(/\.youtube$/i, '.json') : video.name;
      const driveMime = isYoutube ? 'application/json' : (video.type || 'application/octet-stream');
      const metadata = {
        name: driveName,
        mimeType: driveMime,
        parents: [driveFolderId],
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', video.data);

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }

      const driveFile = await res.json();
      // Persist the Drive file ID back to IndexedDB
      await onSetDriveId(video.id, video.idbStore, driveFile.id);
      setStatus(uKey, 'success');
      scheduleReapplyShareAclsAfterTagChange();
    } catch (err) {
      console.error('Upload failed:', err.message);
      uploadTokenRef.current = null;
      removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
      setStatus(uKey, 'error');
    }
  };

  const handleChannelUpload = async (ch) => {
    const uKey = channelUploadKey(ch);
    if (ch.driveId) {
      setStatus(uKey, 'success');
      return;
    }
    setStatus(uKey, 'uploading');
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
      const { id: _id, driveId: _d, ...rest } = ch;
      const payload = JSON.stringify({ _type: CHANNEL_JSON_MARKER, ...rest });
      const blob = new Blob([payload], { type: 'application/json' });
      const label = ch.name || ch.handle || ch.channelId;
      const safeName = String(label).replace(/[/\\?%*:|"<>]/g, '-');
      const driveName = `${safeName}.channel.json`;
      const metadata = {
        name: driveName,
        mimeType: 'application/json',
        parents: [driveFolderId],
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }

      const driveFile = await res.json();
      await onSetDriveId(ch.id, 'channels', driveFile.id);
      setStatus(uKey, 'success');
      scheduleReapplyShareAclsAfterTagChange();
    } catch (err) {
      console.error('Channel upload failed:', err.message);
      uploadTokenRef.current = null;
      removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
      setStatus(uKey, 'error');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await onAddItem(file.name, file.type, file);
    e.target.value = '';
  };

  const handleConfirmClear = () => {
    if (window.confirm('Delete the local database and reinitialize? All locally stored content will be removed. This cannot be undone.')) {
      onClearLibrary();
    }
  };

  const handleSignOutGoogle = () => {
    const tokens = new Set();
    if (uploadTokenRef.current) tokens.add(uploadTokenRef.current);
    for (const t of getAllStoredAccessTokens(credentials.clientId)) tokens.add(t);
    uploadTokenRef.current = null;
    lastScopeRef.current = '';
    clearAllStoredAccessTokens();
    invalidateDriveAccessTokenCache();
    onGoogleUserEmail?.(null);
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      tokens.forEach((token) => google.accounts.oauth2.revoke(token, () => {}));
    }
    onDriveCredentialsChanged?.();
  };

  const runOwnerSync = async () => {
    if (!hasCredentials || isSyncing) return;
    setIsSyncing(true);
    setSyncResult(null);
    setSyncProgress('');
    const combined = {};
    try {
      const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);

      setSyncProgress('Backing up local items...');
      const backupResult = await backupAllToGDrive({
        accessToken: token,
        folderId: driveFolderId,
        items,
        channels,
        onSetDriveId,
        onSetNoteFolderData,
        onProgress: setSyncProgress,
      });
      combined.backed = backupResult.backed;
      combined.backupFailed = backupResult.failed;

      setSyncProgress('Syncing from Drive...');
      const syncResult = await syncDriveToLocal({
        accessToken: token,
        folderId: driveFolderId,
        books: items.filter(i => i.type !== 'application/x-youtube'),
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
        onProgress: setSyncProgress,
      });
      combined.added = syncResult.added;
      combined.updated = syncResult.updated;
      combined.skipped = syncResult.skipped;

      setSyncResult(combined);
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncResult({ error: err.message });
      uploadTokenRef.current = null;
      removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
    } finally {
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const runSync = () => runOwnerSync();

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

  const matchesShareNameOrIncludeTags = (share) => {
    if (!query) return true;
    if ((share.driveFileName || '').toLowerCase().includes(query)) return true;
    const nq = normalizeTag(query);
    if (!nq) return false;
    for (const t of share.includeTags || []) {
      const nt = normalizeTag(t);
      if (nt && nt.includes(nq)) return true;
    }
    return false;
  };

  const shareRefDriveIds = useMemo(() => {
    if (!activeShareFilter) return null;
    return new Set(
      (activeShareFilter.explicitRefs || [])
        .map((r) => String(r.driveId || '').trim())
        .filter(Boolean)
    );
  }, [activeShareFilter]);

  const filteredItems = items.filter(item => {
    if (shareRefDriveIds) {
      if (!item.driveId || !shareRefDriveIds.has(String(item.driveId))) return false;
    }
    if (activeFilters.size > 0 && !activeFilters.has(item.idbStore)) return false;
    if (query && !matchesNameOrTags(item.name, item.tags)) return false;
    return true;
  });

  const filteredChannels = (channels || []).filter(ch => {
    if (shareRefDriveIds) {
      if (!ch.driveId || !shareRefDriveIds.has(String(ch.driveId))) return false;
    }
    if (activeFilters.size > 0 && !activeFilters.has('channels')) return false;
    if (query && !matchesNameOrTags(ch.name || ch.handle, ch.tags)) return false;
    return true;
  });

  const filteredShares = (shares || []).filter((s) => {
    if (shareRefDriveIds) return false;
    if (activeFilters.size > 0 && !activeFilters.has('shares')) return false;
    if (query && !matchesShareNameOrIncludeTags(s)) return false;
    return true;
  });

  const totalGridCount = items.length + (channels || []).length + (shares || []).length;
  const filteredGridCount = filteredItems.length + filteredChannels.length + filteredShares.length;

  const hasActiveSearch = query || activeFilters.size > 0 || !!activeShareFilter;

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
    for (const sh of shares || []) {
      addName(sh.driveFileName || '', 'share');
    }

    const tagSeen = new Set();
    for (const t of availableTags) {
      const n = normalizeTag(t);
      if (!n || tagSeen.has(n)) continue;
      tagSeen.add(n);
      rows.push({ kind: 'tag', category: 'tag', label: n, value: n });
    }
    for (const sh of shares || []) {
      for (const t of sh.includeTags || []) {
        const n = normalizeTag(t);
        if (!n || tagSeen.has(n)) continue;
        tagSeen.add(n);
        rows.push({ kind: 'tag', category: 'share-tag', label: n, value: n });
      }
    }

    return rows;
  }, [items, channels, shares, availableTags]);

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

  const folderBadge = hasCredentials && React.createElement(
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

  const syncButton = hasCredentials && React.createElement(
    'button',
    {
      onClick: runSync,
      disabled: isSyncing,
      className: 'flex items-center gap-1.5 bg-teal-800 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-bold py-2 px-4 rounded-xl transition-all active:scale-95',
      title: 'Back up local items to Drive, then sync Drive → local',
    },
    isSyncing
      ? React.createElement('div', { className: 'h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin' })
      : React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
        ),
    isSyncing ? (syncProgress || 'Syncing...') : 'Sync'
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

        // Sync button (backup local → Drive, then sync Drive → local)
        hasCredentials && syncButton,

        // Add Content dropdown
        React.createElement(
          'div',
          { className: 'relative' },
          React.createElement(
            'button',
            {
              onClick: () => setIsAddMenuOpen(prev => !prev),
              className: 'flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-xl transition-all active:scale-95'
            },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' })
            ),
            'Add Content',
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' })
            )
          ),
          isAddMenuOpen && React.createElement(
            'div',
            {
              className: 'absolute right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden',
              onMouseLeave: () => setIsAddMenuOpen(false)
            },
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); setIsNewNoteOpen(true); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors'
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-emerald-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' })
              ),
              'New Note'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); setIsYoutubeOpen(true); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors'
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-red-400', fill: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
              ),
              'Add YouTube'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); setIsChannelOpen(true); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors'
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-red-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' })
              ),
              'Add Channel'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); fileInputRef.current?.click(); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors'
              },
              React.createElement(BookIcon, { className: 'h-4 w-4 text-indigo-400' }),
              'Add File'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); openNewShare(); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors border-t border-gray-700'
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-teal-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z' })
              ),
              'New share'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setIsAddMenuOpen(false); openLinkShare(); },
                className: 'flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors'
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-amber-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' })
              ),
              'Link share…'
            )
          )
        ),
        React.createElement('input', {
          ref: fileInputRef,
          type: 'file',
          accept: '.epub,.pdf,.txt,.md,application/epub+zip,application/pdf,text/plain,text/markdown',
          onChange: handleFileChange,
          className: 'hidden'
        }),

        // System settings button
        React.createElement(
          'button',
          {
            onClick: () => setIsSystemSettingsOpen(true),
            className: 'text-gray-500 hover:text-gray-300 p-2 rounded-xl hover:bg-gray-700 transition-colors',
            title: 'System settings'
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }),
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' })
          )
        )
      )
    ),

    // Search bar (with name + tag suggestions)
    React.createElement(
      'div',
      { className: 'mb-4 flex flex-col gap-2' },
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
          'aria-expanded': searchInputFocused && searchSuggestions.length > 0,
          'aria-controls': 'library-search-suggestions',
          role: 'combobox',
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          onFocus: () => setSearchInputFocused(true),
          onBlur: () => setSearchInputFocused(false),
          onKeyDown: handleSearchKeyDown,
          placeholder: 'Search name, filename, or tags...',
          className: 'w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors',
        }),
        searchQuery && React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => { setSearchQuery(''); setSearchSuggestIndex(-1); },
            className: 'absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors z-10',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        ),
        searchInputFocused && searchSuggestions.length > 0 &&
          React.createElement(
            'ul',
            {
              id: 'library-search-suggestions',
              role: 'listbox',
              className:
                'absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 shadow-xl shadow-black/40 py-1 z-50',
            },
            searchSuggestions.map((row, idx) => {
              const catLabel =
                row.category === 'item'
                  ? 'Item'
                  : row.category === 'channel'
                    ? 'Channel'
                    : row.category === 'share'
                      ? 'Share'
                      : row.category === 'share-tag'
                        ? 'Share tag'
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
                    onMouseDown: (e) => {
                      e.preventDefault();
                      applySearchSuggestion(row);
                    },
                    onMouseEnter: () => setSearchSuggestIndex(idx),
                  },
                  React.createElement(
                    'span',
                    {
                      className:
                        'shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ' +
                        (row.kind === 'tag'
                          ? 'bg-amber-900/50 text-amber-200/90'
                          : 'bg-gray-600/80 text-gray-300'),
                    },
                    catLabel
                  ),
                  React.createElement(
                    'span',
                    { className: 'min-w-0 flex-1 truncate', title: row.value },
                    row.label
                  )
                )
              );
            })
          )
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2 flex-wrap' },
        [
          { key: 'books',    label: 'Books',    activeClass: 'bg-indigo-600 border-indigo-500 text-white' },
          { key: 'notes',    label: 'Notes',    activeClass: 'bg-emerald-600 border-emerald-500 text-white' },
          { key: 'videos',   label: 'Videos',   activeClass: 'bg-red-600 border-red-500 text-white' },
          { key: 'channels', label: 'Channels', activeClass: 'bg-red-900 border-red-800 text-white' },
          { key: 'shares', label: 'Shares', activeClass: 'bg-teal-800 border-teal-600 text-white' },
        ].map(({ key, label, activeClass }) =>
          React.createElement(
            'button',
            {
              key,
              onClick: () => toggleFilter(key),
              className: 'px-3 py-1 rounded-lg text-xs font-semibold border transition-all ' + (
                activeFilters.has(key)
                  ? activeClass
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
              ),
            },
            label
          )
        ),
        hasActiveSearch && React.createElement(
          'button',
          {
            onClick: () => { setSearchQuery(''); setActiveFilters(new Set()); },
            className: 'px-3 py-1 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors',
          },
          'Clear filters'
        )
      )
    ),

    // Sync result banner (covers both backup and sync phases)
    syncResult && React.createElement(
      'div',
      {
        className: `mb-4 px-4 py-2 rounded-xl text-sm flex items-center justify-between ${syncResult.error ? 'bg-red-900/30 text-red-300 border border-red-800/40' : 'bg-teal-900/30 text-teal-300 border border-teal-800/40'}`,
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
          ].filter(Boolean).join(', '),
      React.createElement(
        'button',
        { onClick: () => setSyncResult(null), className: 'ml-4 text-current opacity-60 hover:opacity-100 text-lg leading-none' },
        '×'
      )
    ),

    // Active share filter banner
    activeShareFilter && React.createElement(
      'div',
      { className: 'mb-4 px-4 py-2.5 rounded-xl text-sm flex items-center justify-between bg-amber-900/30 text-amber-200 border border-amber-800/40' },
      React.createElement(
        'span',
        { className: 'flex items-center gap-2' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z' })
        ),
        `Viewing share: ${activeShareFilter.driveFileName || activeShareFilter.id}`,
        ` (${filteredItems.length + filteredChannels.length} items)`
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement(
          'button',
          {
            onClick: () => { setActiveShareFilter(null); setActiveShare(activeShareFilter); },
            className: 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-800/50 hover:bg-amber-700/60 text-amber-100 transition-colors',
          },
          'Edit'
        ),
        React.createElement(
          'button',
          {
            onClick: () => setActiveShareFilter(null),
            className: 'text-current opacity-60 hover:opacity-100 text-lg leading-none',
          },
          '\u00d7'
        )
      )
    ),

    // Channels section
    filteredChannels.length > 0 && React.createElement(
      'div',
      { className: 'mb-6' },
      React.createElement(
        'div',
        {
          className:
            'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6',
        },
        filteredChannels.map((ch) =>
          React.createElement(DataTile, {
            key: ch.id,
            tileType: 'channel',
            channel: ch,
            onSelect: onSelectChannel,
            onDelete: handleDeleteChannelRequest,
            onUpload: handleChannelUpload,
            uploadStatus: uploadStatuses[channelUploadKey(ch)] ?? null,
            readOnly: false,
            onSetTags: (c, tags) => setRecordTagsAndReapplyShares(c.id, 'channels', tags),
            availableTags,
          })
        )
      )
    ),

    // Shares
    filteredShares.length > 0 &&
      React.createElement(
        'div',
        { className: 'mb-6' },
        React.createElement(
          'div',
          {
            className:
              'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6',
          },
          filteredShares.map((s) =>
            React.createElement(DataTile, {
              key: `share-${s.id}`,
              tileType: 'share',
              share: s,
              onSelect: (rec) => {
                if (rec.role === 'receiver') {
                  handleOpenReceiverShare(rec);
                } else {
                  setActiveShare(rec);
                }
              },
              onDelete: (rec) => {
                deleteShare(rec.id);
                if (activeShare?.id === rec.id) setActiveShare(null);
                if (activeShareFilter?.id === rec.id) setActiveShareFilter(null);
              },
              readOnly: false,
            })
          )
        )
      ),

    // Item grid or empty state
    filteredItems.length > 0
      ? React.createElement(
          'div',
          { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
          filteredItems.map((video) =>
            React.createElement(DataTile, {
              key: libraryItemKey(video),
              tileType: 'item',
              item: video,
              onSelect: onSelectItem,
              onDelete: handleDeleteItemRequest,
              onUpload: handleUpload,
              uploadStatus: uploadStatuses[libraryItemKey(video)] ?? null,
              readOnly: false,
              onSetTags: (v, tags) => setRecordTagsAndReapplyShares(v.id, v.idbStore, tags),
              availableTags,
            })
          )
        )
      : hasActiveSearch &&
          filteredItems.length === 0 &&
          filteredChannels.length === 0 &&
          filteredShares.length === 0
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
              activeShareFilter
                ? 'None of the shared items have been synced locally yet. Try syncing first.'
                : query ? `No items matching "${searchQuery.trim()}"` : 'No items match the selected filters'
            ),
            React.createElement(
              'button',
              {
                onClick: () => { setSearchQuery(''); setActiveFilters(new Set()); setActiveShareFilter(null); },
                className: 'mt-4 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors',
              },
              activeShareFilter ? 'Clear share filter' : 'Clear search'
            )
          )
        : hasActiveSearch
          ? null
          : React.createElement(
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
            React.createElement(
              'button',
              {
                onClick: () => fileInputRef.current?.click(),
                className: 'mt-6 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl transition-all'
              },
              React.createElement(BookIcon, { className: 'h-5 w-5' }),
              'Add Your First File'
            )
          ),

    // New note modal
    isNewNoteOpen && React.createElement(NewNoteModal, {
      onSave:  onAddItem,
      onClose: () => setIsNewNoteOpen(false),
    }),

    // New YouTube modal
    isYoutubeOpen && React.createElement(NewYoutubeModal, {
      onSave:  onAddItem,
      onClose: () => setIsYoutubeOpen(false),
    }),

    // New Channel modal
    isChannelOpen && React.createElement(NewChannelModal, {
      onSave:  onAddChannel,
      onClose: () => setIsChannelOpen(false),
    }),

    activeShare &&
      React.createElement(SharesEditorModal, {
        key: activeShare.id,
        share: activeShare,
        readOnly: activeShare.role === 'receiver',
        availableTags,
        pickableWithDriveId,
        allItems: items,
        allChannels: channels,
        onClose: () => setActiveShare(null),
        onSaveOwner: handleOwnerSaveShare,
        onRefreshReceiver: activeShare.role === 'receiver' ? handleRefreshReceiverShare : undefined,
      }),


    // System settings modal
    isSystemSettingsOpen && React.createElement(
      'div',
      {
        className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4',
        onClick: (e) => { if (e.target === e.currentTarget) setIsSystemSettingsOpen(false); },
      },
      React.createElement(
        'div',
        { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-700 overflow-hidden' },

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
          { className: 'p-6 space-y-5' },

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
          )
        )
      )
    ),

    pendingDelete &&
      React.createElement(DeleteContentModal, {
        title: pendingDelete.kind === 'item' ? 'Remove item' : 'Remove channel',
        name:
          pendingDelete.kind === 'item'
            ? pendingDelete.item.name
            : pendingDelete.channel.name || pendingDelete.channel.handle || 'Channel',
        hasDriveCopy: true,
        canDeleteFromDrive: hasCredentials,
        onRemoveLocal: runPendingDeleteLocal,
        onRemoveFromDrive: runPendingDeleteWithDrive,
        onClose: closePendingDelete,
      })
  );
};
