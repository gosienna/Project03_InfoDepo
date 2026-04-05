
import React, { useRef, useState, useEffect } from 'react';
import { VideoCard } from './VideoCard.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { DevDriveBrowser } from './DevDriveBrowser.js';
import { DriveSettingsModal } from './DriveSettingsModal.js';
import { getDriveCredentials, saveDriveCredentials } from '../utils/driveCredentials.js';
import { NewNoteModal } from './NewNoteModal.js';
import { NewYoutubeModal } from './NewYoutubeModal.js';
import { NewChannelModal } from './NewChannelModal.js';
import { syncDriveToLocal, backupAllToGDrive } from '../utils/driveSync.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';

const YT_API_KEY = import.meta.env.VITE_TEST_API_KEY || '';

const IS_DEV = import.meta.env.DEV;
// Combined scope: drive.file (create/update app files) + drive.readonly (list/download any file)
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

export const Library = ({
  items, channels, onSelectItem, onSelectChannel, onAddItem, onDeleteItem, onClearLibrary,
  onSetDriveId, onGetAllImages,
  onAddChannel, onDeleteChannel,
  getBookByDriveId, getBookByName, upsertDriveBook,
  getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
}) => {
  const fileInputRef      = useRef(null);
  const uploadTokenRef    = useRef(null);
  const [isDevBrowserOpen, setIsDevBrowserOpen] = useState(false);
  const [isSettingsOpen,   setIsSettingsOpen]   = useState(false);
  const [driveFolderName,  setDriveFolderName]  = useState(null);
  const [uploadStatuses,   setUploadStatuses]   = useState({});
  const [credentials,      setCredentials]      = useState(() => getDriveCredentials());
  const [isNewNoteOpen,    setIsNewNoteOpen]    = useState(false);
  const [isYoutubeOpen,    setIsYoutubeOpen]    = useState(false);
  const [isChannelOpen,    setIsChannelOpen]    = useState(false);

  // Search state
  const [searchQuery,      setSearchQuery]      = useState('');
  const [activeFilters,    setActiveFilters]    = useState(new Set());

  // Sync + Backup state (combined operation)
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [syncResult,  setSyncResult]  = useState(null);
  const [syncProgress, setSyncProgress] = useState('');

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

  // Clear cached token if client ID changes
  useEffect(() => {
    uploadTokenRef.current = null;
  }, [credentials.clientId]);

  const setStatus = (key, status) =>
    setUploadStatuses(prev => ({ ...prev, [key]: status }));

  const getDriveToken = () =>
    new Promise((resolve, reject) => {
      if (uploadTokenRef.current) { resolve(uploadTokenRef.current); return; }
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google API not loaded')); return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: credentials.clientId,
        scope: DRIVE_SCOPE,
        callback: (res) => {
          if (res.error) { reject(new Error(res.error_description || res.error)); return; }
          uploadTokenRef.current = res.access_token;
          resolve(res.access_token);
        },
      });
      client.requestAccessToken({ prompt: '' });
    });

  const handleUpload = async (video) => {
    const uKey = libraryItemKey(video);
    setStatus(uKey, 'uploading');
    try {
      const token = await getDriveToken();

      // YouTube links: upload as .json so Drive can display the content
      const isYoutube = video.type === 'application/x-youtube';
      const driveName = isYoutube ? video.name.replace(/\.youtube$/i, '.json') : video.name;
      const driveMime = isYoutube ? 'application/json' : (video.type || 'application/octet-stream');
      const metadata = {
        name: driveName,
        mimeType: driveMime,
        ...(credentials.folderId ? { parents: [credentials.folderId] } : {}),
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
    } catch (err) {
      console.error('Upload failed:', err.message);
      uploadTokenRef.current = null;
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
    if (window.confirm('Are you sure you want to delete all items from your library? This action cannot be undone.')) {
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
    setSyncProgress('');
    const combined = {};
    try {
      // Single OAuth prompt covers both upload (drive.file) and download (drive.readonly)
      const token = await getDriveToken();

      // Phase 1: backup local-only items to Drive
      setSyncProgress('Backing up local items...');
      const images = onGetAllImages ? await onGetAllImages() : [];
      const backupResult = await backupAllToGDrive({
        accessToken: token,
        folderId: credentials.folderId,
        items,
        images,
        onSetDriveId,
        onProgress: setSyncProgress,
      });
      combined.backed = backupResult.backed;
      combined.backupFailed = backupResult.failed;

      // Phase 2: sync Drive → local (reuse same token)
      setSyncProgress('Syncing from Drive...');
      const syncResult = await syncDriveToLocal({
        accessToken: token,
        apiKey: credentials.apiKey,
        folderId: credentials.folderId,
        books: items.filter(i => i.type !== 'application/x-youtube'),
        getBookByDriveId,
        getBookByName,
        upsertDriveBook,
        getImageByDriveId,
        getImageByName,
        upsertDriveImage,
        getNotes,
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
    } finally {
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const toggleFilter = (filter) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const query = searchQuery.trim().toLowerCase();

  const filteredItems = items.filter(item => {
    if (activeFilters.size > 0 && !activeFilters.has(item.idbStore)) return false;
    if (query && !(item.name || '').toLowerCase().includes(query)) return false;
    return true;
  });

  const filteredChannels = (channels || []).filter(ch => {
    if (activeFilters.size > 0 && !activeFilters.has('channels')) return false;
    if (query && !(ch.name || '').toLowerCase().includes(query)) return false;
    return true;
  });

  const hasActiveSearch = query || activeFilters.size > 0;

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

  const syncButton = hasCredentials && React.createElement(
    'button',
    {
      onClick: runSync,
      disabled: isSyncing,
      className: 'flex items-center gap-1.5 bg-teal-800 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-bold py-2 px-4 rounded-xl transition-all active:scale-95',
      title: 'Back up local items to Drive, then sync Drive → local'
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
          hasActiveSearch ? `${filteredItems.length + filteredChannels.length} / ${items.length + (channels || []).length}` : items.length + (channels || []).length,
          ' ',
          (items.length + (channels || []).length) === 1 ? 'Item' : 'Items'
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

        // Sync button (backup local → Drive, then sync Drive → local)
        hasCredentials && syncButton,

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
            onClick: () => setIsYoutubeOpen(true),
            className: 'flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-xl transition-all active:scale-95',
            title: 'Add a YouTube video'
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
          ),
          'Add YouTube'
        ),

        React.createElement(
          'button',
          {
            onClick: () => setIsChannelOpen(true),
            className: 'flex items-center gap-2 bg-red-900 hover:bg-red-800 text-white font-bold py-2 px-5 rounded-xl transition-all active:scale-95',
            title: 'Add a YouTube channel'
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' })
          ),
          'Add Channel'
        ),

        React.createElement(
          'button',
          {
            onClick: () => fileInputRef.current?.click(),
            className: 'flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-xl transition-all shadow-lg shadow-indigo-500/10 active:scale-95'
          },
          React.createElement(BookIcon, { className: 'h-5 w-5' }),
          React.createElement('span', null, 'Add File')
        ),
        items.length > 0 &&
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

    // Search bar
    React.createElement(
      'div',
      { className: 'mb-4 flex flex-col gap-2' },
      React.createElement(
        'div',
        { className: 'relative' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        ),
        React.createElement('input', {
          type: 'text',
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          placeholder: 'Search library...',
          className: 'w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors',
        }),
        searchQuery && React.createElement(
          'button',
          {
            onClick: () => setSearchQuery(''),
            className: 'absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
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

    // Channels section
    filteredChannels.length > 0 && React.createElement(
      'div',
      { className: 'mb-6' },
      React.createElement('h3', { className: 'text-lg font-bold text-gray-300 mb-3' }, 'YouTube Channels'),
      React.createElement(
        'div',
        { className: 'flex gap-3 overflow-x-auto pb-2' },
        filteredChannels.map((ch) =>
          React.createElement(
            'button',
            {
              key: ch.id,
              onClick: () => onSelectChannel(ch),
              className: 'flex items-center gap-3 bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 border border-gray-700 transition-colors shrink-0 group',
            },
            ch.thumbnailUrl && React.createElement('img', {
              src: ch.thumbnailUrl,
              alt: ch.name,
              className: 'h-10 w-10 rounded-full object-cover border border-gray-600',
            }),
            React.createElement(
              'div',
              { className: 'text-left min-w-0' },
              React.createElement('p', { className: 'text-sm font-semibold text-gray-100 truncate max-w-[160px]' }, ch.name),
              React.createElement(
                'p',
                { className: 'text-xs text-gray-500' },
                (ch.videos || []).length, ' videos'
              )
            ),
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-gray-600 group-hover:text-gray-400 shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 5l7 7-7 7' })
            )
          )
        )
      )
    ),

    // Item grid or empty state
    filteredItems.length > 0
      ? React.createElement(
          'div',
          { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
          filteredItems.map((video) =>
            React.createElement(VideoCard, {
              key: libraryItemKey(video),
              video: video,
              onSelect: onSelectItem,
              onDelete: onDeleteItem,
              onUpload: handleUpload,
              uploadStatus: uploadStatuses[libraryItemKey(video)] ?? null,
            })
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

    // Drive browser modal
    isDevBrowserOpen && React.createElement(DevDriveBrowser, {
      onFileSelect: onAddItem,
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
      apiKey:  YT_API_KEY,
    })
  );
};
