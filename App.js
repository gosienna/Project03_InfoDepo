
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { GoogleLoginGate } from './components/GoogleLoginGate.js';
import { DriveFolderGate } from './components/DriveFolderGate.js';
import { Reader } from './components/Reader.js';
import { YoutubeChannelViewer } from './components/YoutubeChannelViewer.js';
import { Explorer } from './components/Explorer.js';
import { Desk } from './components/Desk.js';
import { itemEntryKey, channelEntryKey } from './utils/deskEntryKeys.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { libraryItemKey } from './utils/libraryItemKey.js';
import { needsGoogleSignIn } from './utils/driveOAuthGateCheck.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from './utils/driveCredentials.js';
import { getDriveFolderId } from './utils/driveFolderStorage.js';
import { DeleteContentModal } from './components/DeleteContentModal.js';
import { getOwnerDriveAccessToken } from './utils/driveAccessToken.js';
import { deleteDriveFilesForChannel, deleteDriveFilesForDesk, deleteDriveFilesForMergedItem } from './utils/deleteLibraryContentOnDrive.js';
import { fetchUserConfig, resolveUserType } from './utils/userConfig.js';
import { listAllUserEmails } from './utils/userConfig.js';
import { clearAllStoredAccessTokens } from './utils/driveOAuthStorage.js';
import { fetchGoogleUserEmail } from './utils/googleUser.js';
import { fetchNewChannelVideos } from './utils/youtubeApi.js';
import { NewNoteModal } from './components/NewNoteModal.js';
import { NewYoutubeModal } from './components/NewYoutubeModal.js';
import { NewChannelModal } from './components/NewChannelModal.js';
import { NewUrlModal } from './components/NewUrlModal.js';

const App = () => {
  const {
    items, channels, desks, addItem, updateItem, deleteItem, clearAll, isInitialized,
    setNoteCoverImage,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId, setNoteFolderData,
    addChannel, deleteChannel, updateChannel,
    getChannelByDriveId, upsertDriveChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
    deleteItemByDriveId, deleteChannelByDriveId, getLocalRecordsByOwnerEmail,
    addDesk, deleteDesk, setDeskLayout, setDeskConnections, setDeskTextItems,
    getDeskByDriveId, upsertDriveDesk,
    setRecordTags,
    setItemSharedWith,
    renameItem,
    setItemReadingPosition,
    getPdfAnnotationSidecar,
    putPdfAnnotationsForItem,
    setPdfAnnotationDriveSync,
    upsertDrivePdfAnnotation,
    getMergedLibraryItems,
    loadItems,
    loadChannels,
    loadAll,
    dataReady,
    touchItemVisit,
    getTotalStorageUsed,
    checkAndEvict,
  } = useIndexedDB();
  const [googleUserEmail, setGoogleUserEmail] = useState(null);
  // 'loading' | 'master' | 'editor' | 'viewer' | 'unauthorized'
  const [userType, setUserType] = useState('loading');
  const [userConfig, setUserConfig] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [currentDesk, setCurrentDesk] = useState(null);
  const [view, setView] = useState('library');
  const [mode, setMode] = useState('desk'); // 'library' | 'desk' | 'explorer'
  /** Step 1 gate: Google sign-in (all users). True when credentials configured but no valid token. */
  const [loginGateActive, setLoginGateActive] = useState(() => needsGoogleSignIn());
  /** Step 2 gate: Drive folder setup (MASTER/EDITOR only). True until folder ID is saved. */
  const [driveFolderReady, setDriveFolderReady] = useState(() => !!getDriveFolderId().trim());
  const [pendingChannelDelete, setPendingChannelDelete] = useState(null);
  const [pendingDeskDelete, setPendingDeskDelete] = useState(null);
  const [pendingItemDelete, setPendingItemDelete] = useState(null);
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const syncFnRef = useRef(null);
  const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
  const [isYoutubeOpen, setIsYoutubeOpen] = useState(false);
  const [isChannelOpen, setIsChannelOpen] = useState(false);
  const [isUrlOpen, setIsUrlOpen] = useState(false);
  const fileInputRef = useRef(null);

  const recheckDriveOAuthGate = useCallback(() => {
    setLoginGateActive(needsGoogleSignIn());
  }, []);

  const handleLoginSuccess = useCallback((email) => {
    if (email) setGoogleUserEmail(email);
    setLoginGateActive(false);
  }, []);

  const handleDriveFolderSuccess = useCallback(() => {
    setDriveFolderReady(true);
  }, []);

  // When credentials are not configured (no VITE_CLIENT_ID), skip all gates → full editor access.
  useEffect(() => {
    if (!needsGoogleSignIn() && !getDriveCredentials().clientId?.trim()) {
      setUserType('editor');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When gate is skipped because a cached token exists, fetch email from the stored token.
  useEffect(() => {
    if (loginGateActive || googleUserEmail) return;
    if (!getDriveCredentials().clientId?.trim()) return; // no credentials → already handled above
    let cancelled = false;
    getOwnerDriveAccessToken()
      .then((token) => fetchGoogleUserEmail(token))
      .then((email) => { if (!cancelled && email) setGoogleUserEmail(email); })
      .catch(() => { if (!cancelled) setUserType('editor'); });
    return () => { cancelled = true; };
  }, [loginGateActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!googleUserEmail) return;
    const masterEmail = (import.meta.env.VITE_MASTER || '').trim().toLowerCase();
    const isMasterUser = googleUserEmail.trim().toLowerCase() === masterEmail;
    if (!import.meta.env.VITE_CONFIG) {
      setUserType(isMasterUser ? 'master' : 'editor');
      return;
    }
    setUserType(isMasterUser ? 'master' : 'loading');
    let cancelled = false;
    getOwnerDriveAccessToken()
      .then((token) => fetchUserConfig(token))
      .then((config) => {
        if (!cancelled) {
          setUserConfig(config);
          if (!isMasterUser) {
            const type = resolveUserType(googleUserEmail, config);
            setUserType(type ?? 'unauthorized');
          } else {
            setUserType('master');
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (isMasterUser) setUserType('master');
          else setUserType('unauthorized');
        }
      });
    return () => { cancelled = true; };
  }, [googleUserEmail]);

  useEffect(() => {
    if (userType === 'viewer' && mode === 'explorer') setMode('library');
  }, [userType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep currentChannel in sync with IndexedDB (so video list updates after a refresh).
  useEffect(() => {
    if (!currentChannel) return;
    const updated = channels.find((c) => c.id === currentChannel.id);
    if (updated) setCurrentChannel(updated);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep currentDesk in sync with IndexedDB (layout saves update the desks array).
  useEffect(() => {
    if (!currentDesk) return;
    const updated = desks.find((d) => d.id === currentDesk.id);
    if (updated) setCurrentDesk(updated);
    else setCurrentDesk(null);
  }, [desks]); // eslint-disable-line react-hooks/exhaustive-deps

  // When switching to desk mode, auto-select the most-recently-visited desk.
  useEffect(() => {
    if (mode === 'desk' && !currentDesk && desks.length > 0) {
      const timeOf = (d) => new Date(d.lastVisitedAt ?? d.localModifiedAt ?? d.modifiedTime ?? 0).getTime();
      const mostRecent = desks.reduce((best, d) => timeOf(d) > timeOf(best) ? d : best, desks[0]);
      setCurrentDesk(mostRecent);
    }
  }, [mode, desks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update lastVisitedAt when user opens an item.
  useEffect(() => {
    if (!currentVideo) return;
    touchItemVisit(currentVideo.id, currentVideo.idbStore);
  }, [currentVideo?.id, currentVideo?.idbStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run LRU eviction check once after initial data load.
  useEffect(() => {
    if (dataReady) checkAndEvict();
  }, [dataReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // On startup, silently check every channel for new videos and update IndexedDB.
  useEffect(() => {
    if (!isInitialized || !channels.length) return;
    if (!hasGoogleApiKeyOrProxy(getDriveCredentials())) return;

    const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const now = Date.now();

    channels.forEach((ch) => {
      const lastRefreshed = ch.lastRefreshedAt ? new Date(ch.lastRefreshedAt).getTime() : 0;
      if (now - lastRefreshed < REFRESH_INTERVAL_MS) return;

      fetchNewChannelVideos(ch)
        .then((newVideos) => {
          if (!newVideos.length) {
            // No new videos — still update lastRefreshedAt so we don't recheck for an hour.
            updateChannel(ch.id, { lastRefreshedAt: new Date() });
            return;
          }
          const merged = [...newVideos, ...(ch.videos || [])];
          updateChannel(ch.id, { videos: merged, lastRefreshedAt: new Date() });
        })
        .catch((err) => {
          console.warn(`[InfoDepo] Channel refresh failed for "${ch.name}":`, err);
        });
    });
  }, [isInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  const openVideo = (video) => {
    const ext = video.name?.split('.').pop()?.toLowerCase() ?? '';
    const mime = video.type || '';
    const isUrl = ext === 'url' || mime === 'application/x-url';
    if (isUrl) {
      if (video.data) {
        video.data.text().then((text) => {
          try {
            const { url } = JSON.parse(text);
            if (url) window.open(url, '_blank');
          } catch {}
        }).catch(() => {});
      }
      return;
    }
    // EPUB/MOBI/AZW files open in a dedicated tab (reader.html) so that
    // foliate-js's blob: URLs run in a top-level browsing context, avoiding
    // WebKitBlobResource errors that occur when iframes are nested inside a
    // Shadow DOM inside the main React app on iOS/iPadOS Safari.
    const isEpub = ['epub', 'mobi', 'azw', 'azw3'].includes(ext)
      || ['application/epub+zip', 'application/x-mobipocket-ebook',
          'application/vnd.amazon.ebook', 'application/vnd.amazon.mobi8-ebook'].includes(mime);
    if (isEpub && video.id != null) {
      window.open(`/reader.html?id=${encodeURIComponent(video.id)}&store=${encodeURIComponent(video.idbStore || 'books')}`, '_blank');
      return;
    }
    // PDFs open in a dedicated tab (pdf-reader.html) to avoid blob: URL access
    // errors on iOS/iPadOS Safari when the viewer is embedded in the main app.
    const isPdf = ext === 'pdf' || mime === 'application/pdf';
    if (isPdf && video.id != null) {
      window.open(`/pdf-reader.html?id=${encodeURIComponent(video.id)}&store=${encodeURIComponent(video.idbStore || 'books')}`, '_blank');
      return;
    }
    setCurrentVideo(video);
    setView('reader');
  };

  const handleSelectVideo = (video) => {
    openVideo(video);
  };

  const handleBackToLibrary = () => {
    setCurrentVideo(null);
    setCurrentChannel(null);
    setView('library');
  };

  const handleSelectChannel = (channel) => {
    setCurrentChannel(channel);
    setView('channel');
  };

  const handleSelectDesk = (desk) => {
    setCurrentDesk(desk);
    setMode('desk');
    setView('library');
    touchItemVisit(desk.id, 'desks');
  };

  const isEditor = userType === 'master' || userType === 'editor';
  const normalizedUserEmail = String(googleUserEmail || '').trim().toLowerCase();
  const shareableUserEmails = useMemo(() => {
    const all = listAllUserEmails(userConfig).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean);
    if (!all.length) return [];
    return all.filter((email) => email !== normalizedUserEmail);
  }, [userConfig, normalizedUserEmail]);

  const canEditShareForRecord = useCallback((record) => {
    if (!isEditor || !record) return false;
    const owner = String(record.ownerEmail || '').trim().toLowerCase();
    if (!owner) return true;
    return owner === normalizedUserEmail;
  }, [isEditor, normalizedUserEmail]);

  const handleAddDesk = async (name) => {
    const id = await addDesk(name);
    const newDesk = { id, name, layout: {}, connections: [] };
    setCurrentDesk(newDesk);
    setMode('desk');
    setView('library');
  };

  const inferStore = (name, type) => {
    const n = (name || '').toLowerCase();
    const mime = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (n.endsWith('.youtube') || mime === 'application/x-youtube') return 'videos';
    if (/\.(md|markdown|mdown|mkd)$/i.test(n) || mime === 'text/markdown' || mime === 'text/x-markdown' || mime === 'text/md') return 'notes';
    return 'books';
  };

  const addToDeskIfActive = useCallback((store, id) => {
    if (mode !== 'desk' || !currentDesk || id == null) return;
    const key = store === 'channel'
      ? channelEntryKey({ id, driveId: '' })
      : itemEntryKey({ id, idbStore: store, driveId: '' });
    const currentLayout = currentDesk.layout || {};
    const count = Object.keys(currentLayout).length;
    const newLayout = { ...currentLayout, [key]: { x: 60 + (count * 20) % 200, y: 60 + (count * 20) % 100 } };
    setDeskLayout(currentDesk.id, newLayout);
  }, [mode, currentDesk, setDeskLayout]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const id = await addItem(file.name, file.type, file);
    addToDeskIfActive(inferStore(file.name, file.type), id);
    e.target.value = '';
  };

  const driveCreds = getDriveCredentials();
  const driveFolderId = getDriveFolderId();
  const hasDriveLibrarySetup = !!(
    driveCreds.clientId &&
    hasGoogleApiKeyOrProxy(driveCreds) &&
    String(driveFolderId || '').trim()
  );

  const recordHasDriveCopy = (rec) => !!(rec?.driveId && String(rec.driveId).trim());

  const handleRequestDeleteChannel = (channel) => {
    if (!recordHasDriveCopy(channel) || !hasDriveLibrarySetup) {
      if (window.confirm(`Remove channel "${channel.name}" from your library?`)) {
        deleteChannel(channel.id);
        handleBackToLibrary();
      }
      return;
    }
    setPendingChannelDelete(channel);
  };

  const handleRequestDeleteItem = (video) => {
    if (!video || video.id == null) return;
    if (!recordHasDriveCopy(video) || !hasDriveLibrarySetup) {
      if (window.confirm(`Are you sure you want to delete "${video.name}"?`)) {
        deleteItem(video.id, video.type);
      }
      return;
    }
    setPendingItemDelete(video);
  };

  const closeItemDeleteModal = () => setPendingItemDelete(null);

  const runItemDeleteLocal = async () => {
    if (!pendingItemDelete) return;
    try {
      await deleteItem(pendingItemDelete.id, pendingItemDelete.type);
      closeItemDeleteModal();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not remove item.');
    }
  };

  const runItemDeleteWithDrive = async () => {
    if (!pendingItemDelete) return;
    try {
      const token = await getOwnerDriveAccessToken();
      await deleteDriveFilesForMergedItem(token, pendingItemDelete, getImagesForNote);
      await deleteItem(pendingItemDelete.id, pendingItemDelete.type);
      closeItemDeleteModal();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not delete on Google Drive or remove locally.');
    }
  };

  const handleRequestDeleteDesk = (desk) => {
    if (!desk || desk.id == null) return;
    const label = desk.name || 'Untitled Desk';
    if (!recordHasDriveCopy(desk) || !hasDriveLibrarySetup) {
      if (window.confirm(`Remove desk "${label}"?`)) {
        deleteDesk(desk.id);
      }
      return;
    }
    setPendingDeskDelete(desk);
  };

  const closeChannelDeleteModal = () => setPendingChannelDelete(null);
  const closeDeskDeleteModal = () => setPendingDeskDelete(null);

  const runChannelDeleteLocal = async () => {
    if (!pendingChannelDelete) return;
    try {
      await deleteChannel(pendingChannelDelete.id);
      closeChannelDeleteModal();
      handleBackToLibrary();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not remove channel.');
    }
  };

  const runChannelDeleteWithDrive = async () => {
    if (!pendingChannelDelete) return;
    try {
      const token = await getOwnerDriveAccessToken();
      await deleteDriveFilesForChannel(token, pendingChannelDelete);
      await deleteChannel(pendingChannelDelete.id);
      closeChannelDeleteModal();
      handleBackToLibrary();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not delete on Google Drive or remove locally.');
    }
  };

  const runDeskDeleteLocal = async () => {
    if (!pendingDeskDelete) return;
    try {
      await deleteDesk(pendingDeskDelete.id);
      closeDeskDeleteModal();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not remove desk.');
    }
  };

  const runDeskDeleteWithDrive = async () => {
    if (!pendingDeskDelete) return;
    try {
      const token = await getOwnerDriveAccessToken();
      await deleteDriveFilesForDesk(token, pendingDeskDelete);
      await deleteDesk(pendingDeskDelete.id);
      closeDeskDeleteModal();
    } catch (e) {
      console.error(e);
      window.alert(e?.message || 'Could not delete on Google Drive or remove locally.');
    }
  };

  if (!isInitialized || !dataReady) {
    return React.createElement(
      "div",
      { className: "flex items-center justify-center h-screen bg-gray-900 text-white font-sans" },
      React.createElement(
        "div",
        { className: "flex flex-col items-center gap-4" },
        React.createElement("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" }),
        React.createElement("p", { className: "text-gray-400" }, "Initializing…")
      )
    );
  }

  // Gate 1: Google sign-in (all users, before role is known)
  if (loginGateActive) {
    return React.createElement(GoogleLoginGate, { onSuccess: handleLoginSuccess });
  }

  // Gate 2: Drive folder setup (MASTER/EDITOR only, after role is resolved)
  const isEditorOrMaster = userType === 'master' || userType === 'editor';
  if (isEditorOrMaster && !driveFolderReady) {
    return React.createElement(DriveFolderGate, { onSuccess: handleDriveFolderSuccess, userEmail: googleUserEmail, config: userConfig });
  }

  if (userType === 'unauthorized') {
    return React.createElement(
      'div',
      { className: 'min-h-screen bg-gray-900 flex items-center justify-center font-sans' },
      React.createElement(
        'div',
        { className: 'text-center px-6' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-red-500 mx-auto mb-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' })
        ),
        React.createElement('p', { className: 'text-xl font-semibold text-red-400 mb-2' }, 'Access Denied'),
        React.createElement(
          'p',
          { className: 'text-gray-400 text-sm mb-6' },
          googleUserEmail,
          ' is not authorized to use this app.'
        ),
        React.createElement(
          'button',
          {
            className: 'text-indigo-400 hover:underline text-sm',
            onClick: () => { clearAllStoredAccessTokens(); window.location.reload(); },
          },
          'Sign in with a different account'
        )
      )
    );
  }

  if (userType === 'loading' && googleUserEmail) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-screen bg-gray-900 text-white font-sans' },
      React.createElement(
        'div',
        { className: 'flex flex-col items-center gap-4' },
        React.createElement('div', { className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500' }),
        React.createElement('p', { className: 'text-gray-400' }, 'Checking access…')
      )
    );
  }

  return React.createElement(
    "div",
    { className: "min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" },
    React.createElement(Header, {
      onBack: view !== 'library' ? handleBackToLibrary : undefined,
      userEmail: googleUserEmail,
      mode,
      onModeChange: setMode,
      showModeToggle: view === 'library',
      userType,
      onSystemSettings: isEditorOrMaster ? () => setIsSystemSettingsOpen(true) : undefined,
      onSync: isEditorOrMaster && hasDriveLibrarySetup ? () => syncFnRef.current?.() : undefined,
      isSyncing,
      syncProgress,
    }),
    React.createElement('input', {
      ref: fileInputRef,
      type: 'file',
      accept: '.epub,.mobi,.azw,.azw3,.pdf,.txt,.md,application/epub+zip,application/x-mobipocket-ebook,application/vnd.amazon.ebook,application/pdf,text/plain,text/markdown',
      onChange: handleFileChange,
      className: 'hidden',
    }),
    isNewNoteOpen && React.createElement(NewNoteModal, {
      onSave: async (name, type, data) => { const id = await addItem(name, type, data); addToDeskIfActive('notes', id); },
      onClose: () => setIsNewNoteOpen(false),
    }),
    isYoutubeOpen && React.createElement(NewYoutubeModal, {
      onSave: async (name, type, data) => { const id = await addItem(name, type, data); addToDeskIfActive('videos', id); },
      onClose: () => setIsYoutubeOpen(false),
    }),
    isChannelOpen && React.createElement(NewChannelModal, {
      onSave: async (channelData) => { const id = await addChannel(channelData); addToDeskIfActive('channel', id); },
      onClose: () => setIsChannelOpen(false),
    }),
    isUrlOpen && React.createElement(NewUrlModal, {
      onSave: async (name, type, data) => { const id = await addItem(name, type, data); addToDeskIfActive('books', id); },
      onClose: () => setIsUrlOpen(false),
    }),
    React.createElement(
      "main",
      { className: "flex-grow flex flex-col min-h-0" },

      // Library: always mounted so sync stays registered; hidden when another view is active
      React.createElement(
        "div",
        {
          className: mode === 'library' && view === 'library'
            ? 'flex-grow flex flex-col min-h-0 p-4 sm:p-6 md:p-8'
            : 'hidden',
        },
        React.createElement(Library, {
          items,
          channels,
          desks,
          onSelectItem: handleSelectVideo,
          onSelectChannel: handleSelectChannel,
          onSelectDesk: handleSelectDesk,
          onAddDesk: handleAddDesk,
          onRequestDeleteDesk: handleRequestDeleteDesk,
          onAddItem: addItem,
          onSetNoteCoverImage: setNoteCoverImage,
          onDeleteItem: deleteItem,
          onClearLibrary: clearAll,
          onSetDriveId: setItemDriveId,
          onSetNoteFolderData: setNoteFolderData,
          onGetAllImages: getAllImages,
          getImagesForNote,
          onAddChannel: addChannel,
          onDeleteChannel: deleteChannel,
          getChannelByDriveId,
          upsertDriveChannel,
          getDeskByDriveId,
          upsertDriveDesk,
          getBookByDriveId,
          getBookByName,
          upsertDriveBook,
          deleteItemByDriveId,
          deleteChannelByDriveId,
          getLocalRecordsByOwnerEmail,
          getImageByDriveId,
          getImageByName,
          upsertDriveImage,
          getNotes,
          getPdfAnnotationSidecar,
          setPdfAnnotationDriveSync,
          upsertDrivePdfAnnotation,
          setRecordTags,
          setItemSharedWith,
          renameItem,
          getMergedLibraryItems,
          getTotalStorageUsed,
          onGoogleUserEmail: setGoogleUserEmail,
          onDriveCredentialsChanged: recheckDriveOAuthGate,
          loadItems,
          loadChannels,
          loadAll,
          userType,
          userConfig,
          googleUserEmail,
          isSystemSettingsOpen,
          setIsSystemSettingsOpen,
          onOpenNewNote: () => setIsNewNoteOpen(true),
          onOpenYoutube: () => setIsYoutubeOpen(true),
          onOpenChannel: () => setIsChannelOpen(true),
          onOpenFile: () => fileInputRef.current?.click(),
          onOpenUrl: () => setIsUrlOpen(true),
          isSyncing,
          setIsSyncing,
          syncProgress,
          setSyncProgress,
          onRegisterSync: (fn) => { syncFnRef.current = fn; },
        })
      ),

      // Explorer
      mode === 'explorer' && React.createElement(Explorer, {
        addItem,
        addImage,
        onSaved: () => setMode('library'),
      }),

      // Desk
      mode === 'desk' && view === 'library' && (
        currentDesk
          ? React.createElement(Desk, {
              desk: currentDesk,
              items,
              channels,
              desks,
              onSelectItem: handleSelectVideo,
              onSelectChannel: handleSelectChannel,
              onSelectDesk: handleSelectDesk,
              onUpdateLayout: setDeskLayout,
              onUpdateConnections: setDeskConnections,
              onUpdateTextItems: setDeskTextItems,
              onRenameDesk: (id, name) => renameItem(id, 'desks', name),
              onSetTags: (rec, storeName, tags) => setRecordTags(rec.id, storeName, tags),
              onSetSharedWith: (rec, storeName, emails) => setItemSharedWith(rec.id, storeName, emails),
              canShareRecord: canEditShareForRecord,
              shareableEmails: shareableUserEmails,
              onRenameItem: (rec, storeName, name) => renameItem(rec.id, storeName, name),
              onRenameChannel: (rec, storeName, name) => renameItem(rec.id, storeName, name),
              onSetNoteCoverImage: (v, file) => setNoteCoverImage(v.id, file),
              readOnly: false,
              role: userType,
              onOpenNewNote: isEditor ? () => setIsNewNoteOpen(true) : undefined,
              onOpenYoutube: isEditor ? () => setIsYoutubeOpen(true) : undefined,
              onOpenChannel: isEditor ? () => setIsChannelOpen(true) : undefined,
              onOpenFile: isEditor ? () => fileInputRef.current?.click() : undefined,
              onOpenUrl: isEditor ? () => setIsUrlOpen(true) : undefined,
              onSetItemDriveId: isEditor ? setItemDriveId : undefined,
              onRequestDeleteItem: isEditor ? handleRequestDeleteItem : undefined,
              onRequestDeleteChannel: isEditor ? handleRequestDeleteChannel : undefined,
            })
          : React.createElement(
              'div',
              { className: 'flex flex-col items-center justify-center h-full gap-4' },
              React.createElement('p', { className: 'text-gray-400 text-lg' }, 'No desk selected.'),
              React.createElement(
                'button',
                {
                  onClick: () => handleAddDesk('New Desk'),
                  className: 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-6 rounded-xl transition-all',
                },
                'Create First Desk'
              )
            )
      ),

      // Channel viewer
      view === 'channel' && currentChannel && React.createElement(YoutubeChannelViewer, {
        channel: currentChannel,
        onBack: handleBackToLibrary,
        onSelectItem: handleSelectVideo,
        onDeleteChannel: deleteChannel,
        onRequestDeleteChannel: handleRequestDeleteChannel,
        onUpdateChannel: updateChannel,
        readOnly: false,
      }),

      // Reader
      view === 'reader' && currentVideo && React.createElement(Reader, {
        key: libraryItemKey(currentVideo),
        video: currentVideo,
        onUpdateItem: updateItem,
        onSaveReadingPosition: setItemReadingPosition,
        getPdfAnnotationSidecar,
        putPdfAnnotationsForItem,
        onAddImage: addImage,
        onGetImages: getImagesForNote,
        readOnly: false,
        onSelectChannel: handleSelectChannel,
        onAddChannel: addChannel,
        onRename: renameItem,
      }),

      // Fallback
      view !== 'library' && view !== 'channel' && view !== 'reader' && mode !== 'explorer' && mode !== 'desk' &&
        React.createElement(
          "div",
          { className: "flex flex-col items-center justify-center h-64 p-4" },
          React.createElement("p", { className: "text-gray-400" }, "No item selected."),
          React.createElement(
            "button",
            { onClick: handleBackToLibrary, className: "mt-4 text-indigo-400 hover:underline" },
            "Return to Library"
          )
        )
    ),
    pendingChannelDelete &&
      React.createElement(DeleteContentModal, {
        title: 'Remove channel',
        name: pendingChannelDelete.name || pendingChannelDelete.handle || 'Channel',
        hasDriveCopy: true,
        canDeleteFromDrive: hasDriveLibrarySetup,
        onRemoveLocal: runChannelDeleteLocal,
        onRemoveFromDrive: runChannelDeleteWithDrive,
        onClose: closeChannelDeleteModal,
      }),
    pendingDeskDelete &&
      React.createElement(DeleteContentModal, {
        title: 'Remove desk',
        name: pendingDeskDelete.name || 'Untitled Desk',
        hasDriveCopy: recordHasDriveCopy(pendingDeskDelete),
        canDeleteFromDrive: hasDriveLibrarySetup,
        onRemoveLocal: runDeskDeleteLocal,
        onRemoveFromDrive: runDeskDeleteWithDrive,
        onClose: closeDeskDeleteModal,
      }),
    pendingItemDelete &&
      React.createElement(DeleteContentModal, {
        title: 'Remove item',
        name: pendingItemDelete.name || 'Item',
        hasDriveCopy: recordHasDriveCopy(pendingItemDelete),
        canDeleteFromDrive: hasDriveLibrarySetup,
        onRemoveLocal: runItemDeleteLocal,
        onRemoveFromDrive: runItemDeleteWithDrive,
        onClose: closeItemDeleteModal,
      })
  );
};

export default App;
