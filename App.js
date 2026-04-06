
import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { GoogleOAuthGate } from './components/GoogleOAuthGate.js';
import { Reader } from './components/Reader.js';
import { YoutubeChannelViewer } from './components/YoutubeChannelViewer.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { libraryItemKey } from './utils/libraryItemKey.js';
import { needsDriveOAuthLogin } from './utils/driveOAuthGateCheck.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from './utils/driveCredentials.js';
import { getDriveFolderId } from './utils/driveFolderStorage.js';
import { DeleteContentModal } from './components/DeleteContentModal.js';
import { getOwnerDriveAccessToken } from './utils/driveAccessToken.js';
import { deleteDriveFilesForChannel } from './utils/deleteLibraryContentOnDrive.js';

const App = () => {
  const {
    items, channels, shares, addItem, updateItem, deleteItem, clearAll, isInitialized,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId, setNoteFolderData,
    addChannel, deleteChannel, updateChannel,
    getChannelByDriveId, upsertDriveChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
    setRecordTags,
    getMergedLibraryItems,
    getSharesList,
    addShare,
    updateShare,
    deleteShare,
  } = useIndexedDB();
  const [googleUserEmail, setGoogleUserEmail] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [view, setView] = useState('library');
  /** Before first OAuth check completes */
  const [oauthGatePending, setOauthGatePending] = useState(true);
  /** When true, full-screen Google sign-in is shown (Drive configured but no valid token). */
  const [oauthGateActive, setOauthGateActive] = useState(false);
  const [pendingChannelDelete, setPendingChannelDelete] = useState(null);

  const recheckDriveOAuthGate = useCallback(() => {
    setOauthGateActive(needsDriveOAuthLogin());
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    setOauthGateActive(needsDriveOAuthLogin());
    setOauthGatePending(false);
  }, [isInitialized]);

  const handleOAuthGateSuccess = useCallback(() => {
    setOauthGateActive(false);
  }, []);

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

  if (!isInitialized) {
    return React.createElement(
      "div",
      { className: "flex items-center justify-center h-screen bg-gray-900 text-white font-sans" },
      React.createElement(
        "div",
        { className: "flex flex-col items-center gap-4" },
        React.createElement("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" }),
        React.createElement("p", { className: "text-gray-400" }, "Initializing Database...")
      )
    );
  }

  if (oauthGatePending) {
    return React.createElement(
      "div",
      { className: "flex items-center justify-center h-screen bg-gray-900 text-white font-sans" },
      React.createElement(
        "div",
        { className: "flex flex-col items-center gap-4" },
        React.createElement("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" }),
        React.createElement("p", { className: "text-gray-400" }, "Checking Google sign-in…")
      )
    );
  }

  if (oauthGateActive) {
    return React.createElement(GoogleOAuthGate, {
      onSuccess: handleOAuthGateSuccess,
      onGoogleUserEmail: setGoogleUserEmail,
    });
  }

  return React.createElement(
    "div",
    { className: "min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" },
    React.createElement(Header, {
      onBack: view !== 'library' ? handleBackToLibrary : undefined,
      userEmail: googleUserEmail,
    }),
    React.createElement(
      "main",
      { className: "flex-grow flex flex-col min-h-0 p-4 sm:p-6 md:p-8" },
      view === 'library'
        ? React.createElement(Library, {
            items,
            channels,
            shares,
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
            getImageByDriveId,
            getImageByName,
            upsertDriveImage,
            getNotes,
            setRecordTags,
            getMergedLibraryItems,
            getSharesList,
            addShare,
            updateShare,
            deleteShare,
            onGoogleUserEmail: setGoogleUserEmail,
            onDriveCredentialsChanged: recheckDriveOAuthGate,
          })
        : view === 'channel' && currentChannel
        ? React.createElement(YoutubeChannelViewer, {
            channel: currentChannel,
            onBack: handleBackToLibrary,
            onSelectItem: handleSelectVideo,
            onDeleteChannel: deleteChannel,
            onRequestDeleteChannel: handleRequestDeleteChannel,
            readOnly: false,
          })
        : currentVideo
        ? React.createElement(Reader, {
            key: libraryItemKey(currentVideo),
            video: currentVideo,
            onUpdateItem: updateItem,
            onAddImage: addImage,
            onGetImages: getImagesForNote,
            readOnly: false,
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
