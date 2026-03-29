
import React, { useRef, useState, useEffect } from 'react';
import { BookCard } from './BookCard.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { DevDriveBrowser } from './DevDriveBrowser.js';
import { DriveSettingsModal } from './DriveSettingsModal.js';
import { getDriveCredentials, saveDriveCredentials } from '../utils/driveCredentials.js';

const IS_DEV = import.meta.env.DEV;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const Library = ({ books, onSelectBook, onAddBook, onDeleteBook, onClearLibrary }) => {
  const fileInputRef   = useRef(null);
  const uploadTokenRef = useRef(null);
  const [isDevBrowserOpen, setIsDevBrowserOpen] = useState(false);
  const [isSettingsOpen,   setIsSettingsOpen]   = useState(false);
  const [driveFolderName,  setDriveFolderName]  = useState(null);
  const [uploadStatuses,   setUploadStatuses]   = useState({});
  const [credentials,      setCredentials]      = useState(() => getDriveCredentials());

  const hasCredentials = !!(credentials.clientId && credentials.apiKey && credentials.folderId);

  // Fetch folder name whenever credentials change
  useEffect(() => {
    if (!credentials.folderId || !credentials.apiKey || !credentials.apiKey.startsWith('AIza')) return;
    setDriveFolderName(null);
    fetch(`https://www.googleapis.com/drive/v3/files/${credentials.folderId}?fields=name&key=${credentials.apiKey}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.name) setDriveFolderName(data.name); })
      .catch(() => {});
  }, [credentials.folderId, credentials.apiKey]);

  // Clear cached upload token if client ID changes
  useEffect(() => {
    uploadTokenRef.current = null;
  }, [credentials.clientId]);

  const setStatus = (id, status) =>
    setUploadStatuses(prev => ({ ...prev, [id]: status }));

  const getUploadToken = () =>
    new Promise((resolve, reject) => {
      if (uploadTokenRef.current) { resolve(uploadTokenRef.current); return; }
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google API not loaded')); return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: credentials.clientId,
        scope: UPLOAD_SCOPE,
        callback: (res) => {
          if (res.error) { reject(new Error(res.error_description || res.error)); return; }
          uploadTokenRef.current = res.access_token;
          resolve(res.access_token);
        },
      });
      client.requestAccessToken({ prompt: '' });
    });

  const handleUpload = async (book) => {
    setStatus(book.id, 'uploading');
    try {
      const token = await getUploadToken();

      const metadata = {
        name: book.name,
        mimeType: book.type || 'application/octet-stream',
        ...(credentials.folderId ? { parents: [credentials.folderId] } : {}),
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', book.data);

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }

      setStatus(book.id, 'success');
    } catch (err) {
      console.error('Upload failed:', err.message);
      uploadTokenRef.current = null;
      setStatus(book.id, 'error');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await onAddBook(file.name, file.type, file);
    e.target.value = '';
  };

  const handleConfirmClear = () => {
    if (window.confirm('Are you sure you want to delete all books from your local library? This action cannot be undone.')) {
      onClearLibrary();
    }
  };

  const handleDriveButtonClick = () => {
    if (hasCredentials) {
      setIsDevBrowserOpen(true);
    } else {
      setIsSettingsOpen(true);
    }
  };

  const handleSaveCredentials = (newCreds) => {
    saveDriveCredentials(newCreds);
    setCredentials(newCreds);
    setIsSettingsOpen(false);
    setIsDevBrowserOpen(true);
  };

  // Folder badge (shown in both modes when folder name is resolved)
  const folderBadge = driveFolderName && React.createElement(
    'span',
    {
      className: 'flex items-center gap-1 bg-gray-800 border border-gray-600/40 text-gray-300 text-xs font-mono px-2.5 py-1.5 rounded-lg',
      title: `Linked Drive folder: ${driveFolderName}`
    },
    React.createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3 w-3 shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 7a2 2 0 012-2h3.586a1 1 0 01.707.293L11 7h10a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' })
    ),
    driveFolderName
  );

  return React.createElement(
    React.Fragment,
    null,

    // Toolbar
    React.createElement(
      'div',
      { className: 'flex items-center justify-between mb-6' },
      React.createElement(
        'h2',
        { className: 'text-3xl font-bold text-gray-100' },
        'My Library'
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement(
          'span',
          { className: 'text-sm text-gray-500 font-medium bg-gray-800 px-3 py-1 rounded-full border border-gray-700' },
          books.length,
          ' ',
          books.length === 1 ? 'Book' : 'Books'
        ),

        // Dev mode: yellow DEV button
        IS_DEV && React.createElement(
          'div',
          { className: 'flex items-center gap-1.5' },
          React.createElement(
            'button',
            {
              onClick: handleDriveButtonClick,
              className: 'flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-bold py-2 px-5 rounded-xl transition-all active:scale-95',
              title: 'Load from test Drive folder (dev only)'
            },
            'DEV: Test Folder'
          ),
          folderBadge
        ),

        // Production mode: Drive Folder button + gear icon
        !IS_DEV && React.createElement(
          'div',
          { className: 'flex items-center gap-1.5' },
          React.createElement(
            'button',
            {
              onClick: handleDriveButtonClick,
              className: 'flex items-center gap-2 bg-teal-700 hover:bg-teal-600 text-white font-bold py-2 px-5 rounded-xl transition-all active:scale-95',
              title: hasCredentials ? 'Browse Drive folder' : 'Set up Google Drive credentials'
            },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 7a2 2 0 012-2h3.586a1 1 0 01.707.293L11 7h10a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' })
            ),
            'Drive Folder'
          ),
          hasCredentials && React.createElement(
            'button',
            {
              onClick: () => setIsSettingsOpen(true),
              className: 'text-gray-500 hover:text-gray-300 p-2 rounded-xl hover:bg-gray-700 transition-colors',
              title: 'Edit Drive credentials'
            },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }),
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' })
            )
          ),
          folderBadge
        ),

        React.createElement(
          'button',
          {
            onClick: () => fileInputRef.current?.click(),
            className: 'flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-xl transition-all shadow-lg shadow-indigo-500/10 active:scale-95'
          },
          React.createElement(BookIcon, { className: 'h-5 w-5' }),
          React.createElement('span', null, 'Add Book')
        ),
        books.length > 0 &&
          React.createElement(
            'button',
            {
              onClick: handleConfirmClear,
              className: 'bg-red-900/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/50 p-2.5 rounded-xl transition-all',
              title: 'Clear Library'
            },
            React.createElement(TrashIcon, { className: 'h-5 w-5' })
          ),
        React.createElement('input', {
          ref: fileInputRef,
          type: 'file',
          accept: '.epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain',
          onChange: handleFileChange,
          className: 'hidden'
        })
      )
    ),

    // Book grid or empty state
    books.length > 0
      ? React.createElement(
          'div',
          { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
          books.map((book) =>
            React.createElement(BookCard, {
              key: book.id,
              book: book,
              onSelect: onSelectBook,
              onDelete: onDeleteBook,
              onUpload: handleUpload,
              uploadStatus: uploadStatuses[book.id] ?? null,
            })
          )
        )
      : React.createElement(
          'div',
          { className: 'text-center py-20 px-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20' },
          React.createElement(
            'div',
            { className: 'bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700' },
            React.createElement(BookIcon, { className: 'h-8 w-8 text-gray-600' })
          ),
          React.createElement(
            'h3',
            { className: 'text-xl font-semibold text-gray-400' },
            'Library is Empty'
          ),
          React.createElement(
            'p',
            { className: 'text-gray-500 mt-2 max-w-sm mx-auto' },
            'Click "Add Book" to import an EPUB, PDF, or TXT file from your device.'
          ),
          React.createElement(
            'button',
            {
              onClick: () => fileInputRef.current?.click(),
              className: 'mt-6 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl transition-all'
            },
            React.createElement(BookIcon, { className: 'h-5 w-5' }),
            'Add Your First Book'
          )
        ),

    // Drive browser modal
    isDevBrowserOpen && React.createElement(DevDriveBrowser, {
      onFileSelect: onAddBook,
      onClose: () => setIsDevBrowserOpen(false),
      clientId: credentials.clientId,
      apiKey:   credentials.apiKey,
      folderId: credentials.folderId,
    }),

    // Settings modal (production only)
    isSettingsOpen && React.createElement(DriveSettingsModal, {
      onSave:  handleSaveCredentials,
      onClose: () => setIsSettingsOpen(false),
    })
  );
};
