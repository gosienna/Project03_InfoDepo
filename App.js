
import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { GoogleLoginGate } from './components/GoogleLoginGate.js';
import { DriveFolderGate } from './components/DriveFolderGate.js';
import { Reader } from './components/Reader.js';
import { YoutubeChannelViewer } from './components/YoutubeChannelViewer.js';
import { Explorer } from './components/Explorer.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { libraryItemKey } from './utils/libraryItemKey.js';
import { needsGoogleSignIn } from './utils/driveOAuthGateCheck.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from './utils/driveCredentials.js';
import { getDriveFolderId } from './utils/driveFolderStorage.js';
import { DeleteContentModal } from './components/DeleteContentModal.js';
import { getOwnerDriveAccessToken } from './utils/driveAccessToken.js';
import { deleteDriveFilesForChannel } from './utils/deleteLibraryContentOnDrive.js';
import { fetchUserConfig, resolveUserType } from './utils/userConfig.js';
import { clearAllStoredAccessTokens } from './utils/driveOAuthStorage.js';
import { fetchGoogleUserEmail } from './utils/googleUser.js';
import { fetchNewChannelVideos } from './utils/youtubeApi.js';

const App = () => {
  const {
    items, channels, addItem, updateItem, deleteItem, clearAll, isInitialized,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId, setNoteFolderData,
    addChannel, deleteChannel, updateChannel,
    getChannelByDriveId, upsertDriveChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
    deleteItemByDriveId, deleteChannelByDriveId, getLocalRecordsByOwnerEmail,
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
  } = useIndexedDB();
  const [googleUserEmail, setGoogleUserEmail] = useState(null);
  // 'loading' | 'master' | 'editor' | 'viewer' | 'unauthorized'
  const [userType, setUserType] = useState('loading');
  const [userConfig, setUserConfig] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [view, setView] = useState('library');
  const [mode, setMode] = useState('library'); // 'library' | 'explorer'
  /** Step 1 gate: Google sign-in (all users). True when credentials configured but no valid token. */
  const [loginGateActive, setLoginGateActive] = useState(() => needsGoogleSignIn());
  /** Step 2 gate: Drive folder setup (MASTER/EDITOR only). True until folder ID is saved. */
  const [driveFolderReady, setDriveFolderReady] = useState(() => !!getDriveFolderId().trim());
  const [pendingChannelDelete, setPendingChannelDelete] = useState(null);

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
    const isEpub = ext === 'epub' || mime === 'application/epub+zip';
    if (isEpub) {
      window.open(`/reader.html?id=${video.id}`, '_blank');
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

  const closeChannelDeleteModal = () => setPendingChannelDelete(null);

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
    }),
    React.createElement(
      "main",
      { className: `flex-grow flex flex-col min-h-0 ${mode === 'explorer' ? '' : 'p-4 sm:p-6 md:p-8'}` },
      mode === 'explorer'
        ? React.createElement(Explorer, {
            addItem,
            addImage,
            onSaved: () => setMode('library'),
          })
        : view === 'library'
        ? React.createElement(Library, {
            items,
            channels,
            onSelectItem: handleSelectVideo,
            onSelectChannel: handleSelectChannel,
            onAddItem: addItem,
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
            onGoogleUserEmail: setGoogleUserEmail,
            onDriveCredentialsChanged: recheckDriveOAuthGate,
            loadItems,
            loadChannels,
            loadAll,
            userType,
            userConfig,
            googleUserEmail,
          })
        : view === 'channel' && currentChannel
        ? React.createElement(YoutubeChannelViewer, {
            channel: currentChannel,
            onBack: handleBackToLibrary,
            onSelectItem: handleSelectVideo,
            onDeleteChannel: deleteChannel,
            onRequestDeleteChannel: handleRequestDeleteChannel,
            onUpdateChannel: updateChannel,
            readOnly: false,
          })
        : currentVideo
        ? React.createElement(Reader, {
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
          })
        : React.createElement(
            "div",
            { className: "flex flex-col items-center justify-center h-64" },
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
      })
  );
};

export default App;
