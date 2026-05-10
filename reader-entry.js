import './utils/mapGetOrInsertComputedPolyfill.js';
import './utils/safariDeferredBlobUrlRevoke.js';

import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { FoliateViewer } from './components/FoliateViewer.js';
import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from './utils/infodepoDb.js';
import { getDriveCredentials } from './utils/driveCredentials.js';
import { getStoredAccessToken } from './utils/driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from './utils/driveScopes.js';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    // If the main app hasn't run yet the DB won't exist — surface a clear error.
    req.onupgradeneeded = () => {
      req.transaction.abort();
      reject(new Error('IndexedDB not initialised — open the main InfoDepo tab first.'));
    };
  });
}

async function getItem(db, id, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ?? null);
  });
}

async function saveBlobToIdb(db, id, storeName, blob) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const os = tx.objectStore(storeName);
    const getReq = os.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) { resolve(); return; }
      const putReq = os.put({ ...record, data: blob, size: blob.size });
      putReq.onsuccess = () => resolve();
      putReq.onerror = (e) => reject(e.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

async function saveReadingPosition(db, id, storeName, position) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const getReq = store.get(id);
    getReq.onerror = () => reject(getReq.error);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) { resolve(); return; }
      const putReq = store.put({ ...item, readingPosition: position });
      putReq.onerror = () => reject(putReq.error);
      putReq.onsuccess = () => resolve();
    };
  });
}

/** Fetch a Drive file and report byte-level progress. Returns a Blob. */
async function fetchWithProgress(url, headers, fallbackSize, onProgress, cancelledFn) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
  const mimeType = r.headers.get('content-type') || 'application/octet-stream';
  // Safari/iOS may return a null body for cross-origin CORS responses; fall back to arrayBuffer.
  if (!r.body || typeof r.body.getReader !== 'function') {
    const buffer = await r.arrayBuffer();
    if (cancelledFn()) return null;
    onProgress(buffer.byteLength, buffer.byteLength);
    return new Blob([buffer], { type: mimeType });
  }
  const contentLength = parseInt(r.headers.get('content-length') || '0') || fallbackSize || 0;
  const reader = r.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (cancelledFn()) { reader.cancel(); return null; }
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, contentLength);
  }
  return new Blob(chunks, { type: mimeType });
}

const fmtBytes = (b) => {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};

function DownloadProgress({ name, loaded, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const known = total > 0;

  return React.createElement(
    'div',
    { className: 'flex flex-col items-center justify-center h-full gap-6 px-10 bg-gray-900' },
    React.createElement(
      'p',
      { className: 'text-gray-200 text-sm font-medium text-center max-w-xs leading-snug', style: { wordBreak: 'break-word' } },
      name || 'Loading…'
    ),
    React.createElement(
      'div',
      { className: 'w-72 flex flex-col gap-2' },
      React.createElement(
        'div',
        { className: 'flex justify-between text-xs' },
        React.createElement('span', { className: 'text-gray-400' },
          known ? `${fmtBytes(loaded)} / ${fmtBytes(total)}` : (loaded > 0 ? fmtBytes(loaded) : '')
        ),
        React.createElement('span', { className: 'text-indigo-400 font-semibold tabular-nums' },
          known ? `${pct}%` : ''
        ),
      ),
      React.createElement(
        'div',
        { className: 'h-1.5 rounded-full bg-gray-700 overflow-hidden' },
        React.createElement('div', {
          className: known ? 'h-full rounded-full bg-indigo-500' : 'h-full rounded-full bg-indigo-500 animate-pulse',
          style: { width: known ? `${pct}%` : '40%', transition: 'width 120ms ease-out' },
        }),
      ),
    ),
    React.createElement('p', { className: 'text-gray-500 text-xs tracking-wide' }, 'Downloading from Google Drive…'),
  );
}

function EpubReaderApp() {
  const [book, setBook] = useState(null);
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [bookName, setBookName] = useState('');
  const [dlLoaded, setDlLoaded] = useState(0);
  const [dlTotal, setDlTotal] = useState(0);

  const params = new URLSearchParams(window.location.search);
  const rawId = params.get('id');
  const storeName = params.get('store') || 'books';
  // IndexedDB keys are auto-increment integers; parse accordingly.
  const itemId = rawId != null ? (isNaN(Number(rawId)) ? rawId : Number(rawId)) : null;

  useEffect(() => {
    if (itemId == null) { setError('No book ID in URL — open this page from the InfoDepo library.'); return; }
    let cancelled = false;
    (async () => {
      try {
        console.log('[InfoDepo][epub-reader] opening DB', { itemId, storeName });
        const database = await openDb();
        if (cancelled) { database.close(); return; }
        setDb(database);
        const item = await getItem(database, itemId, storeName);
        if (cancelled) return;
        if (!item) { setError('Book not found in library.'); return; }
        document.title = (item.name || 'EPUB Reader') + ' — InfoDepo';
        console.log('[InfoDepo][epub-reader] item loaded', { name: item.name, hasData: !!item.data, driveId: item.driveId, size: item.size });

        if (!item.data && item.driveId) {
          const { clientId } = getDriveCredentials();
          const token = clientId ? getStoredAccessToken(clientId, OWNER_DRIVE_SCOPE) : null;
          console.log('[InfoDepo][epub-reader] lazy blob — token check', { clientId: clientId?.slice(0, 10), hasToken: !!token });
          if (!token) {
            console.warn('[InfoDepo][epub-reader] no valid token in localStorage; cannot download blob');
            setError('Book not yet downloaded. Return to the library tab and click the book to fetch it.');
            return;
          }
          console.log('[InfoDepo][epub-reader] downloading blob from Drive...');
          setBookName(item.name || '');
          setDownloading(true);
          let blob;
          try {
            blob = await fetchWithProgress(
              `https://www.googleapis.com/drive/v3/files/${item.driveId}?alt=media`,
              { Authorization: `Bearer ${token}` },
              item.size || 0,
              (loaded, total) => {
                setDlLoaded(loaded);
                setDlTotal(total);
              },
              () => cancelled,
            );
          } finally {}
          if (cancelled || !blob) return;
          console.log('[InfoDepo][epub-reader] blob downloaded, saving to IDB', { size: blob.size });
          await saveBlobToIdb(database, itemId, storeName, blob);
          if (!cancelled) {
            setBook({ ...item, data: blob });
            setDownloading(false);
          }
          return;
        }

        console.log('[InfoDepo][epub-reader] blob already in IDB, rendering');
        setBook(item);
      } catch (err) {
        console.error('[InfoDepo][epub-reader] error:', err?.message || err);
        if (!cancelled) {
          setError(err?.message || String(err));
          setDownloading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [itemId, storeName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSavePosition = useCallback((id, store, position) => {
    if (!db) return Promise.resolve();
    return saveReadingPosition(db, id, store, position).catch(() => {});
  }, [db]);

  if (error) {
    return React.createElement(
      'div',
      { className: 'flex flex-col items-center justify-center h-full gap-3 px-6 text-center' },
      React.createElement('p', { className: 'text-red-400 text-sm max-w-sm' }, error),
      React.createElement('a', {
        href: '/',
        className: 'text-indigo-400 text-sm underline',
      }, '← Back to library'),
    );
  }

  if (downloading) {
    return React.createElement(DownloadProgress, { name: bookName, loaded: dlLoaded, total: dlTotal });
  }

  if (!book) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-full text-gray-400 text-sm' },
      'Loading…',
    );
  }

  return React.createElement(FoliateViewer, {
    data: book.data,
    name: book.name,
    type: book.type,
    itemId: book.id,
    initialReadingPosition: book.readingPosition,
    onSaveReadingPosition: handleSavePosition,
    storeName,
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(EpubReaderApp),
);
