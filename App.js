
import React, { useState } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { Reader } from './components/Reader.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';
import { getDriveCredentials } from './utils/driveCredentials.js';
import { getOAuthToken } from './utils/driveAuth.js';

const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const App = () => {
  const {
    books, addBook, updateBook, deleteBook, clearBooks, isInitialized,
    addAsset, getAssetsForNote,
    getBookByDriveId, getBookByName, upsertDriveBook, evictToMetadata, markAsDownloaded,
  } = useIndexedDB();
  const [currentBook, setCurrentBook] = useState(null);
  const [view, setView] = useState('library');
  const [downloadPromptBook, setDownloadPromptBook] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const openBook = (book) => {
    const ext = book.name.split('.').pop().toLowerCase();
    const mime = book.type || '';
    const isEpub = ext === 'epub' || mime === 'application/epub+zip';
    if (isEpub) {
      window.open(`/reader.html?id=${book.id}`, '_blank');
      return;
    }
    setCurrentBook(book);
    setView('reader');
  };

  const handleSelectBook = (book) => {
    if (book.isMetadataOnly) {
      setDownloadPromptBook(book);
      return;
    }
    openBook(book);
  };

  const handleDownloadAndOpen = async (book) => {
    setIsDownloading(true);
    try {
      const creds = getDriveCredentials();
      const token = await getOAuthToken(creds.clientId, DRIVE_READ_SCOPE);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${book.driveId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      await markAsDownloaded(book.id, blob);
      setDownloadPromptBook(null);
      openBook({ ...book, isMetadataOnly: false, data: blob });
    } catch (err) {
      console.error('Download failed:', err);
      alert(`Failed to download "${book.name}": ${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleBackToLibrary = () => {
    setCurrentBook(null);
    setView('library');
  };

  if (!isInitialized) {
    return React.createElement(
      "div",
      { className: "flex items-center justify-center h-screen bg-gray-900 text-white font-sans" },
      React.createElement(
        "div",
        { className: "flex flex-col items-center gap-4" },
        React.createElement("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" }),
        React.createElement(
          "p",
          { className: "text-gray-400" },
          "Initializing Database..."
        )
      )
    );
  }

  return React.createElement(
    "div",
    { className: "min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" },
    React.createElement(Header, {
      onBack: view === 'reader' ? handleBackToLibrary : undefined,
    }),
    React.createElement(
      "main",
      { className: "flex-grow p-4 sm:p-6 md:p-8" },
      view === 'library'
        ? React.createElement(Library, {
            books,
            onSelectBook: handleSelectBook,
            onAddBook: addBook,
            onDeleteBook: deleteBook,
            onClearLibrary: clearBooks,
            getBookByDriveId,
            getBookByName,
            upsertDriveBook,
            evictToMetadata,
          })
        : currentBook
        ? React.createElement(Reader, {
            book: currentBook,
            onUpdateBook: updateBook,
            onAddAsset: addAsset,
            onGetAssets: getAssetsForNote,
          })
        : React.createElement(
            "div",
            { className: "flex flex-col items-center justify-center h-64" },
            React.createElement(
              "p",
              { className: "text-gray-400" },
              "No book selected."
            ),
            React.createElement(
              "button",
              { onClick: handleBackToLibrary, className: "mt-4 text-indigo-400 hover:underline" },
              "Return to Library"
            )
          )
    ),

    // Download prompt modal for cloud-only books
    downloadPromptBook && React.createElement(
      'div',
      { className: 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm' },
      React.createElement(
        'div',
        { className: 'bg-gray-800 rounded-2xl w-full max-w-sm p-6 border border-gray-700 text-center' },
        React.createElement(
          'div',
          { className: 'w-12 h-12 rounded-full bg-blue-900/60 flex items-center justify-center mx-auto mb-4 border border-blue-700/50' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-6 w-6 text-blue-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' })
          )
        ),
        React.createElement('p', { className: 'text-white font-bold text-lg mb-2' }, 'Cloud-only book'),
        React.createElement(
          'p',
          { className: 'text-gray-400 text-sm mb-6' },
          React.createElement('span', { className: 'text-gray-200 font-medium' }, `"${downloadPromptBook.name}"`),
          ' is stored in Google Drive. Download it now to read locally?'
        ),
        React.createElement(
          'div',
          { className: 'flex gap-3 justify-center' },
          React.createElement(
            'button',
            {
              onClick: () => setDownloadPromptBook(null),
              disabled: isDownloading,
              className: 'flex-1 px-4 py-2 text-sm text-gray-400 hover:text-white rounded-xl hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-50'
            },
            'Cancel'
          ),
          React.createElement(
            'button',
            {
              onClick: () => handleDownloadAndOpen(downloadPromptBook),
              disabled: isDownloading,
              className: 'flex-1 px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2'
            },
            isDownloading
              ? React.createElement('div', { className: 'h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin' })
              : null,
            isDownloading ? 'Downloading...' : 'Download & Read'
          )
        )
      )
    )
  );
};

export default App;
