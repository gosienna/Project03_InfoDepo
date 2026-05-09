import './utils/mapGetOrInsertComputedPolyfill.js';
import './utils/safariDeferredBlobUrlRevoke.js';

import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { PdfViewer } from './components/PdfViewer.js';
import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from './utils/infodepoDb.js';
import { getDriveCredentials } from './utils/driveCredentials.js';
import { getStoredAccessToken } from './utils/driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from './utils/driveScopes.js';

const PDF_ANNOTATIONS_STORE = 'pdfAnnotations';
const pdfAnnotationSidecarKey = (itemId, idbStore) => `${idbStore}:${itemId}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.transaction.abort();
      reject(new Error('IndexedDB not initialised — open the main InfoDepo tab first.'));
    };
  });
}

function getItem(db, id, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ?? null);
  });
}

function loadAnnotationSidecar(db, itemId, idbStore) {
  const key = pdfAnnotationSidecarKey(itemId, idbStore);
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(PDF_ANNOTATIONS_STORE, 'readonly'); }
    catch { resolve(null); return; }
    const req = tx.objectStore(PDF_ANNOTATIONS_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

function writeAnnotationSidecar(db, itemId, idbStore, annotations, pdfDriveId) {
  const key = pdfAnnotationSidecarKey(itemId, idbStore);
  const now = new Date();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(PDF_ANNOTATIONS_STORE, 'readwrite'); }
    catch (err) { reject(err); return; }
    const os = tx.objectStore(PDF_ANNOTATIONS_STORE);
    const g = os.get(key);
    g.onsuccess = () => {
      const prev = g.result;
      const pdfD = String(pdfDriveId || '').trim() || (prev && String(prev.pdfDriveId || '').trim()) || '';
      const rec = {
        sidecarKey: key,
        itemId,
        idbStore,
        pdfDriveId: pdfD,
        annotations: Array.isArray(annotations) ? annotations : [],
        version: 1,
        annotationDriveId: prev?.annotationDriveId || '',
        modifiedTime: prev?.modifiedTime || '',
        localModifiedAt: now,
      };
      const p = os.put(rec);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    };
    g.onerror = () => reject(g.error);
  });
}

/**
 * iOS Safari IDB blobs reference temporary files that become unreadable once the
 * IDB transaction closes. Copy the blob data into a plain memory-backed Blob
 * immediately after reading from IDB so later reads (pdfjs arrayBuffer) always work.
 */
async function materializeBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return blob;
  const ab = await blob.arrayBuffer();
  return new Blob([ab], { type: blob.type || 'application/pdf' });
}

/** Fetch a Drive file and report byte-level progress. Returns a Blob. */
async function fetchWithProgress(url, headers, fallbackSize, onProgress, cancelledFn) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
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
  const mimeType = r.headers.get('content-type') || 'application/pdf';
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

function saveReadingPosition(db, id, storeName, position) {
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

function PdfReaderApp() {
  const [item, setItem] = useState(null);
  const [annotations, setAnnotations] = useState(null); // null = loading
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [bookName, setBookName] = useState('');
  const [dlLoaded, setDlLoaded] = useState(0);
  const [dlTotal, setDlTotal] = useState(0);

  const params = new URLSearchParams(window.location.search);
  const rawId = params.get('id');
  const storeName = params.get('store') || 'books';
  const itemId = rawId != null ? (isNaN(Number(rawId)) ? rawId : Number(rawId)) : null;

  useEffect(() => {
    if (itemId == null) {
      setError('No item ID in URL — open this page from the InfoDepo library.');
      return;
    }
    let cancelled = false;
    let database;
    (async () => {
      try {
        database = await openDb();
        if (cancelled) { database.close(); return; }
        setDb(database);

        const foundItem = await getItem(database, itemId, storeName);
        if (cancelled) return;
        if (!foundItem) { setError('PDF not found in library.'); return; }

        document.title = (foundItem.name || 'PDF Reader') + ' — InfoDepo';

        let resolvedData = foundItem.data;

        if (!resolvedData && foundItem.driveId) {
          const { clientId } = getDriveCredentials();
          const token = clientId ? getStoredAccessToken(clientId, OWNER_DRIVE_SCOPE) : null;
          if (!token) {
            setError('PDF not yet downloaded. Return to the library tab and click the book to fetch it.');
            return;
          }
          setBookName(foundItem.name || '');
          setDownloading(true);
          let blob;
          try {
            blob = await fetchWithProgress(
              `https://www.googleapis.com/drive/v3/files/${foundItem.driveId}?alt=media`,
              { Authorization: `Bearer ${token}` },
              foundItem.size || 0,
              (loaded, total) => {
                setDlLoaded(loaded);
                setDlTotal(total);
              },
              () => cancelled,
            );
          } finally {}
          if (cancelled || !blob) return;
          await saveBlobToIdb(database, itemId, storeName, blob);
          resolvedData = blob;
          if (!cancelled) setDownloading(false);
        }

        // Materialize IDB blob into memory immediately — iOS Safari IDB blobs reference
        // temporary backing files that become unreadable after the transaction closes.
        const materializedData = await materializeBlob(resolvedData);
        if (cancelled) return;

        let anns = [];
        const sc = await loadAnnotationSidecar(database, itemId, storeName);
        anns = Array.isArray(sc?.annotations) ? sc.annotations : [];

        // Migrate legacy annotations stored inline on readingPosition
        const legacy = foundItem.readingPosition?.pdfAnnotations;
        if (Array.isArray(legacy) && legacy.length > 0 && anns.length === 0) {
          anns = legacy;
          await writeAnnotationSidecar(database, itemId, storeName, anns, String(foundItem.driveId || '').trim()).catch(() => {});
        }

        if (!cancelled) {
          setItem({ ...foundItem, data: materializedData });
          setAnnotations(anns);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setDownloading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSavePosition = useCallback((id, store, position) => {
    if (!db) return Promise.resolve();
    return saveReadingPosition(db, id, store, position).catch(() => {});
  }, [db]);

  const handleSaveAnnotations = useCallback((id, store, anns, pdfDriveId) => {
    if (!db) return Promise.resolve();
    return writeAnnotationSidecar(db, id, store, anns, pdfDriveId).catch(() => {});
  }, [db]);

  if (error) {
    return React.createElement(
      'div',
      { className: 'flex flex-col items-center justify-center h-full gap-3 px-6 text-center' },
      React.createElement('p', { className: 'text-red-400 text-sm max-w-sm' }, error),
      React.createElement('a', { href: '/', className: 'text-indigo-400 text-sm underline' }, '← Back to library'),
    );
  }

  if (downloading) {
    return React.createElement(DownloadProgress, { name: bookName, loaded: dlLoaded, total: dlTotal });
  }

  if (!item || annotations === null) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-full text-gray-400 text-sm' },
      'Loading…',
    );
  }

  return React.createElement(PdfViewer, {
    data: item.data,
    itemId: item.id,
    initialReadingPosition: item.readingPosition,
    initialAnnotations: annotations,
    pdfDriveId: String(item.driveId || '').trim(),
    exportBaseName: String(item.name || 'document').replace(/\.pdf$/i, '') || 'document',
    onSaveReadingPosition: handleSavePosition,
    onSavePdfAnnotations: handleSaveAnnotations,
    storeName,
    readOnly: false,
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(PdfReaderApp),
);
