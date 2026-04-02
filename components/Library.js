
import React, { useRef, useState, useEffect } from 'react';
import { BookCard } from './BookCard.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { DevDriveBrowser } from './DevDriveBrowser.js';
import { DriveSettingsModal } from './DriveSettingsModal.js';
import { getDriveCredentials, saveDriveCredentials } from '../utils/driveCredentials.js';
import { NewNoteModal } from './NewNoteModal.js';
import { getOAuthToken } from '../utils/driveAuth.js';
import { syncDriveToLocal, selectEvictionCandidates } from '../utils/driveSync.js';
import { getSyncSettings, saveSyncSettings } from '../utils/syncSettings.js';
import { formatBytes } from '../utils/fileUtils.js';

const IS_DEV = import.meta.env.DEV;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export const Library = ({
  books, onSelectBook, onAddBook, onDeleteBook, onClearLibrary,
  getBookByDriveId, getBookByName, upsertDriveBook, evictToMetadata,
}) => {
  const fileInputRef      = useRef(null);
  const uploadTokenRef    = useRef(null);
  const storageInputRef   = useRef(null);
  const [isDevBrowserOpen, setIsDevBrowserOpen] = useState(false);
  const [isSettingsOpen,   setIsSettingsOpen]   = useState(false);
  const [driveFolderName,  setDriveFolderName]  = useState(null);
  const [uploadStatuses,   setUploadStatuses]   = useState({});
  const [credentials,      setCredentials]      = useState(() => getDriveCredentials());
  const [isNewNoteOpen,    setIsNewNoteOpen]    = useState(false);

  // Sync state
  const [isSyncing,    setIsSyncing]    = useState(false);
  const [syncResult,   setSyncResult]   = useState(null);
  const [overLimitData, setOverLimitData] = useState(null);
  const [maxStorageMB, setMaxStorageMB] = useState(() => getSyncSettings().maxStorageMB);

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

  const runSync = async () => {
    if (!hasCredentials || isSyncing) return;
    setIsSyncing(true);
    setSyncResult(null);
    setOverLimitData(null);
    try {
      const token = await getOAuthToken(credentials.clientId, READ_SCOPE);
      const result = await syncDriveToLocal({
        accessToken: token,
        apiKey: credentials.apiKey,
        folderId: credentials.folderId,
        maxStorageBytes: maxStorageMB * 1024 * 1024,
        books,
        getBookByDriveId,
        getBookByName,
        upsertDriveBook,
      });
      if (result.overLimit) {
        setOverLimitData(result);
      } else {
        setSyncResult(result);
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncResult({ error: err.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFreeUpSpace = async () => {
    if (!overLimitData) return;
    const idsToEvict = selectEvictionCandidates(overLimitData.candidates, overLimitData.excess);
    setOverLimitData(null);
    await evictToMetadata(idsToEvict);
    // Re-run sync now that space has been freed
    await runSync();
  };

  const handleIncreaseLimit = () => {
    setOverLimitData(null);
    // Focus the storage input so user can type a new value
    setTimeout(() => storageInputRef.current?.focus(), 50);
  };

  // Folder badge
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

  // Sync button (shown only when credentials are available)
  const syncButton = hasCredentials && React.createElement(
    'button',
    {
      onClick: runSync,
      disabled: isSyncing,
      className: 'flex items-center gap-1.5 bg-teal-800 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-bold py-2 px-4 rounded-xl transition-all active:scale-95',
      title: 'Sync library with Drive folder'
    },
    isSyncing
      ? React.createElement('div', { className: 'h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin' })
      : React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
        ),
    isSyncing ? 'Syncing...' : 'Sync'
  );

  // Storage limit input
  const storageInput = React.createElement(
    'div',
    { className: 'flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-xl px-3 py-1.5' },
    React.createElement('span', { className: 'text-xs text-gray-400 whitespace-nowrap' }, 'Sync limit:'),
    React.createElement('input', {
      ref: storageInputRef,
      type: 'number',
      min: 50,
      max: 100000,
      value: maxStorageMB,
      onChange: (e) => setMaxStorageMB(Number(e.target.value)),
      onBlur: () => saveSyncSettings({ maxStorageMB }),
      className: 'w-16 bg-transparent text-sm text-white text-right focus:outline-none',
    }),
    React.createElement('span', { className: 'text-xs text-gray-400' }, 'MB')
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

        // Sync button + storage limit input (shown when credentials set)
        hasCredentials && syncButton,
        hasCredentials && storageInput,

        React.createElement(
          'button',
          {
            onClick: () => setIsNewNoteOpen(true),
            className: 'flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-2 px-5 rounded-xl transition-all active:scale-95',
            title: 'Create a new Markdown note'
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' })
          ),
          'New Note'
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
          accept: '.epub,.pdf,.txt,.md,application/epub+zip,application/pdf,text/plain,text/markdown',
          onChange: handleFileChange,
          className: 'hidden'
        })
      )
    ),

    // Sync result banner
    syncResult && React.createElement(
      'div',
      {
        className: `mb-4 px-4 py-2 rounded-xl text-sm flex items-center justify-between ${syncResult.error ? 'bg-red-900/30 text-red-300 border border-red-800/40' : 'bg-teal-900/30 text-teal-300 border border-teal-800/40'}`,
      },
      syncResult.error
        ? `Sync failed: ${syncResult.error}`
        : `Sync complete — ${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.metadataOnly} cloud-only, ${syncResult.skipped} unchanged`,
      React.createElement(
        'button',
        {
          onClick: () => setSyncResult(null),
          className: 'ml-4 text-current opacity-60 hover:opacity-100 text-lg leading-none'
        },
        '×'
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
    }),

    // New note modal
    isNewNoteOpen && React.createElement(NewNoteModal, {
      onSave:  onAddBook,
      onClose: () => setIsNewNoteOpen(false),
    }),

    // Over-limit modal
    overLimitData && React.createElement(
      'div',
      { className: 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm' },
      React.createElement(
        'div',
        { className: 'bg-gray-800 rounded-2xl w-full max-w-md p-6 border border-gray-700' },
        React.createElement('h2', { className: 'text-lg font-bold text-white mb-2' }, 'Storage limit exceeded'),
        React.createElement(
          'p',
          { className: 'text-gray-400 text-sm mb-2' },
          `Your Drive-synced library uses ${formatBytes((overLimitData.candidates.reduce((s, b) => s + (b.size || 0), 0)))} — ${formatBytes(overLimitData.excess)} over your ${maxStorageMB} MB limit.`
        ),
        React.createElement(
          'p',
          { className: 'text-gray-500 text-xs mb-6' },
          '"Free up space" will convert the oldest/largest Drive-synced books to cloud-only stubs and then re-run sync.'
        ),
        // List of candidates to be evicted (preview)
        overLimitData.candidates.length > 0 && React.createElement(
          'div',
          { className: 'mb-5 max-h-36 overflow-y-auto rounded-xl bg-gray-900/60 border border-gray-700 divide-y divide-gray-700/50' },
          selectEvictionCandidates(overLimitData.candidates, overLimitData.excess).map(id => {
            const book = overLimitData.candidates.find(b => b.id === id);
            return book ? React.createElement(
              'div',
              { key: id, className: 'flex items-center justify-between px-3 py-2 text-xs' },
              React.createElement('span', { className: 'text-gray-300 truncate mr-2', title: book.name }, book.name),
              React.createElement('span', { className: 'text-gray-500 shrink-0' }, formatBytes(book.size))
            ) : null;
          })
        ),
        React.createElement(
          'div',
          { className: 'flex gap-3' },
          React.createElement(
            'button',
            {
              onClick: () => setOverLimitData(null),
              className: 'flex-1 px-4 py-2 text-sm text-gray-400 hover:text-white rounded-xl hover:bg-gray-700 transition-colors border border-gray-700'
            },
            'Cancel'
          ),
          React.createElement(
            'button',
            {
              onClick: handleIncreaseLimit,
              className: 'flex-1 px-4 py-2 text-sm font-bold bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors'
            },
            'Increase limit'
          ),
          React.createElement(
            'button',
            {
              onClick: handleFreeUpSpace,
              className: 'flex-1 px-4 py-2 text-sm font-bold bg-orange-700 hover:bg-orange-600 text-white rounded-xl transition-colors'
            },
            'Free up space'
          )
        )
      )
    )
  );
};
