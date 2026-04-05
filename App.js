
import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { GoogleOAuthGate } from './components/GoogleOAuthGate.js';
import { Reader } from './components/Reader.js';
import { YoutubeChannelViewer } from './components/YoutubeChannelViewer.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { libraryItemKey } from './utils/libraryItemKey.js';
import { getLibraryMode as readLibraryMode, setLibraryMode as persistLibraryMode } from './utils/libraryMode.js';
import { needsDriveOAuthLogin } from './utils/driveOAuthGateCheck.js';

const App = () => {
  const {
    items, channels, addItem, updateItem, deleteItem, clearAll, isInitialized,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId,
    addChannel, deleteChannel, updateChannel,
    getChannelByDriveId, upsertDriveChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
    setRecordTags,
    getTagSharesList, setTagShareEmails, deleteTagShare,
    getMergedLibraryItems,
  } = useIndexedDB();
  const [libraryMode, setLibraryModeState] = useState(() => readLibraryMode());
  const setLibraryMode = (mode) => {
    persistLibraryMode(mode);
    setLibraryModeState(mode);
  };
  const [googleUserEmail, setGoogleUserEmail] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [view, setView] = useState('library');
  /** Before first OAuth check completes */
  const [oauthGatePending, setOauthGatePending] = useState(true);
  /** When true, full-screen Google sign-in is shown (Drive configured but no valid token). */
  const [oauthGateActive, setOauthGateActive] = useState(false);

  const recheckDriveOAuthGate = useCallback(() => {
    setOauthGateActive(needsDriveOAuthLogin());
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    setOauthGateActive(needsDriveOAuthLogin());
    setOauthGatePending(false);
  }, [isInitialized, libraryMode]);

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
      libraryMode,
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
      { className: "flex-grow p-4 sm:p-6 md:p-8" },
      view === 'library'
        ? React.createElement(Library, {
            items,
            channels,
            libraryMode,
            onLibraryModeChange: setLibraryMode,
            onSelectItem: handleSelectVideo,
            onSelectChannel: handleSelectChannel,
            onAddItem: addItem,
            onDeleteItem: deleteItem,
            onClearLibrary: clearAll,
            onSetDriveId: setItemDriveId,
            onGetAllImages: getAllImages,
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
            getTagSharesList,
            setTagShareEmails,
            deleteTagShare,
            getMergedLibraryItems,
            onGoogleUserEmail: setGoogleUserEmail,
            onDriveCredentialsChanged: recheckDriveOAuthGate,
          })
        : view === 'channel' && currentChannel
        ? React.createElement(YoutubeChannelViewer, {
            channel: currentChannel,
            onBack: handleBackToLibrary,
            onSelectItem: handleSelectVideo,
            onDeleteChannel: deleteChannel,
          })
        : currentVideo
        ? React.createElement(Reader, {
            key: libraryItemKey(currentVideo),
            video: currentVideo,
            onUpdateItem: updateItem,
            onAddImage: addImage,
            onGetImages: getImagesForNote,
            readOnly: libraryMode === 'shared',
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
    )
  );
};

export default App;
