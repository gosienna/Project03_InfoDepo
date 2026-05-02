import './utils/mapGetOrInsertComputedPolyfill.js';
import './utils/safariDeferredBlobUrlRevoke.js';

import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { FoliateViewer } from './components/FoliateViewer.js';
import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from './utils/infodepoDb.js';

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

function EpubReaderApp() {
  const [book, setBook] = useState(null);
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const rawId = params.get('id');
  const storeName = params.get('store') || 'books';
  // IndexedDB keys are auto-increment integers; parse accordingly.
  const itemId = rawId != null ? (isNaN(Number(rawId)) ? rawId : Number(rawId)) : null;

  useEffect(() => {
    if (itemId == null) { setError('No book ID in URL — open this page from the InfoDepo library.'); return; }
    let cancelled = false;
    openDb()
      .then(database => {
        if (cancelled) { database.close(); return; }
        setDb(database);
        return getItem(database, itemId, storeName);
      })
      .then(item => {
        if (cancelled || item === undefined) return;
        if (!item) { setError('Book not found in library.'); return; }
        document.title = (item.name || 'EPUB Reader') + ' — InfoDepo';
        setBook(item);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message || String(err));
      });
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
