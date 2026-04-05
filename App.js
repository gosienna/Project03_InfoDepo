
import React, { useState } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { Reader } from './components/Reader.js';
import { YoutubeChannelViewer } from './components/YoutubeChannelViewer.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { libraryItemKey } from './utils/libraryItemKey.js';

const App = () => {
  const {
    items, channels, addItem, updateItem, deleteItem, clearAll, isInitialized,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId,
    addChannel, deleteChannel, updateChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
  } = useIndexedDB();
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [view, setView] = useState('library');

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

  return React.createElement(
    "div",
    { className: "min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" },
    React.createElement(Header, {
      onBack: view !== 'library' ? handleBackToLibrary : undefined,
    }),
    React.createElement(
      "main",
      { className: "flex-grow p-4 sm:p-6 md:p-8" },
      view === 'library'
        ? React.createElement(Library, {
            items,
            channels,
            onSelectItem: handleSelectVideo,
            onSelectChannel: handleSelectChannel,
            onAddItem: addItem,
            onDeleteItem: deleteItem,
            onClearLibrary: clearAll,
            onSetDriveId: setItemDriveId,
            onGetAllImages: getAllImages,
            onAddChannel: addChannel,
            onDeleteChannel: deleteChannel,
            getBookByDriveId,
            getBookByName,
            upsertDriveBook,
            getImageByDriveId,
            getImageByName,
            upsertDriveImage,
            getNotes,
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
