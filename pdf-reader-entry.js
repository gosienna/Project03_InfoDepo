import './utils/mapGetOrInsertComputedPolyfill.js';
import './utils/safariDeferredBlobUrlRevoke.js';

import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { PdfViewer } from './components/PdfViewer.js';
import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from './utils/infodepoDb.js';

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

        // Materialize IDB blob into memory immediately — iOS Safari IDB blobs reference
        // temporary backing files that become unreadable after the transaction closes.
        const materializedData = await materializeBlob(foundItem.data);
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
        if (!cancelled) setError(err?.message || String(err));
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
