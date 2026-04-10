
import { useState, useEffect, useCallback } from 'react';
import { INFO_DEPO_DB_NAME as DB_NAME, INFO_DEPO_DB_VERSION as DB_VERSION } from '../utils/infodepoDb.js';
import { normalizeTagsList } from '../utils/tagUtils.js';
import { parseSharesDriveJsonText, payloadToClientRecord } from '../utils/sharesDriveJson.js';
import { parsePdfAnnotationSidecarText, pdfAnnotationSidecarNeedsBackup, timeMs as sidecarTimeMs } from '../utils/pdfAnnotationSidecar.js';

const BOOKS_STORE    = 'books';
const NOTES_STORE    = 'notes';
const VIDEOS_STORE   = 'videos';
const IMAGES_STORE   = 'images';
const CHANNELS_STORE = 'channels';
const SHARES_STORE   = 'shares';
const PDF_ANNOTATIONS_STORE = 'pdfAnnotations';

const pdfAnnotationSidecarKey = (itemId, idbStore) => `${idbStore}:${itemId}`;


const isYoutubeType = (type) =>
  type != null && String(type).trim() === 'application/x-youtube';
const isNoteType = (type) =>
  type != null && String(type).trim() === 'text/markdown';

const storeForType = (type) => {
  if (isYoutubeType(type)) return VIDEOS_STORE;
  if (isNoteType(type)) return NOTES_STORE;
  return BOOKS_STORE;
};

const blobLikeSize = (data) =>
  (data != null && typeof data.size === 'number' && !Number.isNaN(data.size)) ? data.size : 0;

const MARKDOWN_FILE_RE = /\.(md|markdown|mdown|mkd)$/i;

const storeForNewItem = (name, type) => {
  const n = (name || '').toLowerCase();
  const mime = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (n.endsWith('.youtube')) return VIDEOS_STORE;
  if (isYoutubeType(type)) return VIDEOS_STORE;
  if (MARKDOWN_FILE_RE.test(n)) return NOTES_STORE;
  if (isNoteType(type)) return NOTES_STORE;
  if (mime === 'text/x-markdown' || mime === 'text/md') return NOTES_STORE;
  return BOOKS_STORE;
};

const modifiedTimeSortKey = (rec) => {
  const t = rec?.localModifiedAt ?? rec?.modifiedTime;
  if (t instanceof Date && !Number.isNaN(t.getTime())) return t.getTime();
  if (typeof t === 'string' || typeof t === 'number') {
    const ms = new Date(t).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
};


export const useIndexedDB = () => {
  const [db, setDb] = useState(null);
  const [items, setItems] = useState([]);
  const [channels, setChannels] = useState([]);
  const [shares, setShares] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const initDB = useCallback(() => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('[InfoDepo] IndexedDB upgrade blocked — close other tabs using this site, then reload.');
    };

    request.onerror = (event) => {
      const err = event.target.error;
      console.error('Database error:', err);
      if (err?.name === 'VersionError') {
        // The browser has a DB at a higher version than the current code requests.
        // Delete it and reinitialize from scratch.
        console.warn('[InfoDepo] VersionError — deleting stale database and reinitializing.');
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => initDB();
        del.onerror   = () => setIsInitialized(true);
        return;
      }
      setIsInitialized(true);
    };

    request.onsuccess = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(PDF_ANNOTATIONS_STORE)) {
        console.warn(
          '[InfoDepo] IndexedDB is missing pdfAnnotations — close other tabs, hard refresh, and ensure the app bundle includes INFO_DEPO_DB_VERSION',
          DB_VERSION,
          '(current DB version:',
          database.version,
          ')'
        );
      }
      setDb(database);
      setIsInitialized(true);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (event.oldVersion < 1) {
        const addStore = (name, indexSpec, opts = { keyPath: 'id', autoIncrement: true }) => {
          const s = dbInstance.createObjectStore(name, opts);
          indexSpec.forEach(({ key, path, unique }) => s.createIndex(key, path, { unique }));
          return s;
        };
        addStore(BOOKS_STORE,    [{ key: 'driveId',   path: 'driveId',   unique: false }]);
        addStore(NOTES_STORE,    [{ key: 'driveId',   path: 'driveId',   unique: false }]);
        addStore(VIDEOS_STORE,   [{ key: 'driveId',   path: 'driveId',   unique: false }]);
        addStore(IMAGES_STORE,   [{ key: 'noteId',    path: 'noteId',    unique: false }]);
        addStore(CHANNELS_STORE, [{ key: 'channelId', path: 'channelId', unique: true  }]);
        addStore(SHARES_STORE,   [{ key: 'driveFileId', path: 'driveFileId', unique: false }], { keyPath: 'id' });
      }
      // Sidecar store (not stored inside PDF blobs). Create on any upgrade if missing — avoids gaps when
      // oldVersion checks skipped a release (e.g. DB already at v4 without this store).
      if (!dbInstance.objectStoreNames.contains(PDF_ANNOTATIONS_STORE)) {
        const s = dbInstance.createObjectStore(PDF_ANNOTATIONS_STORE, { keyPath: 'sidecarKey' });
        s.createIndex('pdfDriveId', 'pdfDriveId', { unique: false });
        s.createIndex('annotationDriveId', 'annotationDriveId', { unique: false });
        s.createIndex('itemId', 'itemId', { unique: false });
      }
    };
  }, []);

  useEffect(() => { initDB(); }, [initDB]);

  const loadItems = useCallback((caller = 'unknown') => {
    console.log('[InfoDepo] loadItems called by:', caller);
    if (!db) return;
    let tx;
    try {
      tx = db.transaction([BOOKS_STORE, NOTES_STORE, VIDEOS_STORE], 'readonly');
    } catch (err) {
      console.error('IndexedDB transaction failed (missing store or closed DB):', err);
      setItems([]);
      return;
    }
    let books = [];
    let notes = [];
    let videos = [];
    let remaining = 3;

    const tryCombine = () => {
      remaining--;
      if (remaining > 0) return;
      const withTags = (r, store) => ({
        ...r,
        idbStore: store,
        tags: Array.isArray(r.tags) ? r.tags : [],
      });
      const merged = [
        ...books.map((r) => withTags(r, BOOKS_STORE)),
        ...notes.map((r) => withTags(r, NOTES_STORE)),
        ...videos.map((r) => withTags(r, VIDEOS_STORE)),
      ].sort((a, b) => modifiedTimeSortKey(b) - modifiedTimeSortKey(a));
      if (import.meta.env.DEV) {
        console.info(
          `[InfoDepo] ${location.origin} — DB rows: books=${books.length} notes=${notes.length} videos=${videos.length} → library UI: ${merged.length}`
        );
      }
      setItems(merged);
    };

    const booksReq = tx.objectStore(BOOKS_STORE).getAll();
    booksReq.onsuccess  = (e) => { books  = e.target.result; tryCombine(); };
    booksReq.onerror    = (e) => { console.error('Error loading books:', e.target.error); tryCombine(); };

    const notesReq = tx.objectStore(NOTES_STORE).getAll();
    notesReq.onsuccess  = (e) => { notes  = e.target.result; tryCombine(); };
    notesReq.onerror    = (e) => { console.error('Error loading notes:', e.target.error); tryCombine(); };

    const videosReq = tx.objectStore(VIDEOS_STORE).getAll();
    videosReq.onsuccess = (e) => { videos = e.target.result; tryCombine(); };
    videosReq.onerror   = (e) => { console.error('Error loading videos:', e.target.error); tryCombine(); };
  }, [db]);

  const loadChannels = useCallback((caller = 'unknown') => {
    console.log('[InfoDepo] loadChannels called by:', caller);
    if (!db) return;
    let tx;
    try { tx = db.transaction(CHANNELS_STORE, 'readonly'); }
    catch { setChannels([]); return; }
    const req = tx.objectStore(CHANNELS_STORE).getAll();
    req.onsuccess = (e) => setChannels(
      e.target.result
        .map((r) => ({ ...r, tags: Array.isArray(r.tags) ? r.tags : [] }))
        .sort((a, b) => modifiedTimeSortKey(b) - modifiedTimeSortKey(a))
    );
    req.onerror = () => setChannels([]);
  }, [db]);

  const loadShares = useCallback((caller = 'unknown') => {
    console.log('[InfoDepo] loadShares called by:', caller);
    if (!db) return;
    let tx;
    try {
      tx = db.transaction(SHARES_STORE, 'readonly');
    } catch {
      setShares([]);
      return;
    }
    const req = tx.objectStore(SHARES_STORE).getAll();
    req.onsuccess = () => setShares(req.result || []);
    req.onerror = () => setShares([]);
  }, [db]);

  /** @returns {Promise<import('../utils/sharesDriveJson.js').ShareClientRecord[]>} */
  const getSharesList = useCallback(
    () =>
      new Promise((resolve) => {
        if (!db) {
          resolve([]);
          return;
        }
        let tx;
        try {
          tx = db.transaction(SHARES_STORE, 'readonly');
        } catch {
          resolve([]);
          return;
        }
        const req = tx.objectStore(SHARES_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      }),
    [db]
  );

  const getShareById = useCallback((id) => {
    if (!db || !id) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARES_STORE, 'readonly');
      const req = tx.objectStore(SHARES_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, [db]);

  const getShareByDriveFileId = useCallback((driveFileId) => {
    if (!db || !driveFileId) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARES_STORE, 'readonly');
      const ix = tx.objectStore(SHARES_STORE).index('driveFileId');
      const req = ix.get(driveFileId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, [db]);

  useEffect(() => {
    if (isInitialized) {
      loadItems('useEffect[isInitialized]');
      loadChannels('useEffect[isInitialized]');
      loadShares('useEffect[isInitialized]');
    }
  }, [isInitialized, loadItems, loadChannels, loadShares]);

  /** Merged books + notes + videos for Drive share ACL resolution (same shape as Library `items`). */
  const getMergedLibraryItems = useCallback(() => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction([BOOKS_STORE, NOTES_STORE, VIDEOS_STORE], 'readonly');
      } catch {
        resolve([]);
        return;
      }
      let books = [];
      let notes = [];
      let videos = [];
      let remaining = 3;
      const finish = () => {
        remaining--;
        if (remaining > 0) return;
        const withTags = (r, store) => ({
          ...r,
          idbStore: store,
          tags: Array.isArray(r.tags) ? r.tags : [],
        });
        const merged = [
          ...books.map((r) => withTags(r, BOOKS_STORE)),
          ...notes.map((r) => withTags(r, NOTES_STORE)),
          ...videos.map((r) => withTags(r, VIDEOS_STORE)),
        ].sort((a, b) => modifiedTimeSortKey(b) - modifiedTimeSortKey(a));
        resolve(merged);
      };
      const bq = tx.objectStore(BOOKS_STORE).getAll();
      bq.onsuccess = (e) => { books = e.target.result; finish(); };
      bq.onerror = () => finish();
      const nq = tx.objectStore(NOTES_STORE).getAll();
      nq.onsuccess = (e) => { notes = e.target.result; finish(); };
      nq.onerror = () => finish();
      const vq = tx.objectStore(VIDEOS_STORE).getAll();
      vq.onsuccess = (e) => { videos = e.target.result; finish(); };
      vq.onerror = () => finish();
    });
  }, [db]);

  const addShare = useCallback(
    (record) => {
      if (!db) return Promise.reject(new Error('Database not initialized'));
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SHARES_STORE, 'readwrite');
        const req = tx.objectStore(SHARES_STORE).put(record);
        req.onsuccess = () => {
          loadShares('addShare');
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    },
    [db, loadShares]
  );

  const updateShare = useCallback(
    (id, patch) => {
      if (!db) return Promise.reject(new Error('Database not initialized'));
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SHARES_STORE, 'readwrite');
        const os = tx.objectStore(SHARES_STORE);
        const g = os.get(id);
        g.onsuccess = () => {
          const existing = g.result;
          if (!existing) {
            reject(new Error('Share not found'));
            return;
          }
          const p = os.put({ ...existing, ...patch });
          p.onsuccess = () => {
            loadShares('updateShare');
            resolve();
          };
          p.onerror = () => reject(p.error);
        };
        g.onerror = () => reject(g.error);
      });
    },
    [db, loadShares]
  );

  const deleteShare = useCallback(
    (id) => {
      if (!db) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SHARES_STORE, 'readwrite');
        const req = tx.objectStore(SHARES_STORE).delete(id);
        req.onsuccess = () => {
          loadShares('deleteShare');
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    },
    [db, loadShares]
  );

  const addItem = useCallback(async (name, type, data) => {
    if (!db) { console.error('Database not initialized'); return Promise.reject(new Error('Database not initialized')); }
    const mime = typeof type === 'string' ? type.trim() : type;
    const size = blobLikeSize(data);
    const store = storeForNewItem(name, mime);
    if (store === VIDEOS_STORE && size === 0) {
      return Promise.reject(new Error('YouTube entry has no data to save.'));
    }
    let storedType = mime;
    const lowerName = (name || '').toLowerCase();
    if (store === NOTES_STORE && !isNoteType(mime)) {
      storedType = 'text/markdown';
    } else if (store === VIDEOS_STORE && !isYoutubeType(mime) && lowerName.endsWith('.youtube')) {
      storedType = 'application/x-youtube';
    }
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(store, 'readwrite');
      } catch (err) {
        console.error('addItem: transaction failed:', store, err);
        reject(err);
        return;
      }
      const now = new Date();
      const record = {
        name, type: storedType, data, size, driveId: '',
        modifiedTime: now,
        localModifiedAt: now,
        tags: [],
      };
      const addRequest = tx.objectStore(store).add(record);
      addRequest.onsuccess = () => { loadItems('addItem'); resolve(); };
      addRequest.onerror   = (e) => { console.error('Error adding item:', store, e.target.error); reject(e.target.error); };
    });
  }, [db, loadItems]);

  const updateItem = useCallback((id, content, type) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    const mime = type != null && String(type).trim() !== '' ? String(type).trim() : 'text/markdown';
    const preferred  = storeForType(mime);
    const secondary  = preferred === NOTES_STORE ? BOOKS_STORE : NOTES_STORE;
    const size       = blobLikeSize(content);

    const tryStore = (store, allowFallback) =>
      new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(store, 'readwrite'); } catch (err) { reject(err); return; }
        const os = tx.objectStore(store);
        const getRequest = os.get(id);
        getRequest.onsuccess = () => {
          const existing = getRequest.result;
          if (!existing) {
            if (allowFallback) { tryStore(secondary, false).then(resolve).catch(reject); }
            else               { reject(new Error('Item not found')); }
            return;
          }
          const nextType = store === NOTES_STORE && !isNoteType(existing.type) ? 'text/markdown' : existing.type;
          // Do NOT update modifiedTime here — it tracks the last known Drive revision.
          // localModifiedAt marks local edits for backup upload (local newer than Drive).
          const putRequest = os.put({
            ...existing,
            type: nextType,
            data: content,
            size,
            localModifiedAt: new Date(),
            tags: Array.isArray(existing.tags) ? existing.tags : [],
          });
          putRequest.onsuccess = () => { loadItems('updateItem'); resolve(); };
          putRequest.onerror   = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });

    return tryStore(preferred, true);
  }, [db, loadItems]);

  // Store image inside the parent note's `assets` array instead of a separate images record.
  const addImage = useCallback((noteId, name, data, type) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      const os = tx.objectStore(NOTES_STORE);
      const req = os.get(noteId);
      req.onsuccess = () => {
        const note = req.result;
        if (!note) { reject(new Error('Note not found')); return; }
        const assets = Array.isArray(note.assets) ? [...note.assets] : [];
        const idx = assets.findIndex(a => a.name === name);
        const asset = { name, data, type, driveId: '' };
        if (idx >= 0) assets[idx] = asset; else assets.push(asset);
        const putReq = os.put({ ...note, assets, localModifiedAt: new Date() });
        putReq.onsuccess = (e) => resolve(e.target.result);
        putReq.onerror   = (e) => reject(e.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  // Read assets from note.assets; fall back to legacy images store for old records.
  const getImagesForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve) => {
      let noteAssets = [];
      let legacyAssets = [];
      let pending = 2;
      const finish = () => {
        pending--;
        if (pending > 0) return;
        // Merge: note.assets takes precedence; legacy entries not already present by name are appended.
        const names = new Set(noteAssets.map(a => a.name));
        resolve([...noteAssets, ...legacyAssets.filter(a => !names.has(a.name))]);
      };
      const noteTx = db.transaction(NOTES_STORE, 'readonly');
      const noteReq = noteTx.objectStore(NOTES_STORE).get(noteId);
      noteReq.onsuccess = (e) => { noteAssets = Array.isArray(e.target.result?.assets) ? e.target.result.assets : []; finish(); };
      noteReq.onerror   = () => finish();
      const imgTx = db.transaction(IMAGES_STORE, 'readonly');
      const imgReq = imgTx.objectStore(IMAGES_STORE).index('noteId').getAll(IDBKeyRange.only(noteId));
      imgReq.onsuccess = (e) => { legacyAssets = e.target.result || []; finish(); };
      imgReq.onerror   = () => finish();
    });
  }, [db]);

  // Flatten assets from all notes' assets arrays (new storage).
  const getAllImages = useCallback(() => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = (e) => {
        const all = [];
        for (const note of e.target.result) {
          if (Array.isArray(note.assets)) {
            all.push(...note.assets.map(a => ({ ...a, noteId: note.id })));
          }
        }
        resolve(all);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const getImageByDriveId = useCallback((driveId) => {
    if (!db || !driveId) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = (e) => {
        for (const note of e.target.result) {
          if (Array.isArray(note.assets)) {
            const found = note.assets.find(a => a.driveId === driveId);
            if (found) { resolve({ ...found, noteId: note.id }); return; }
          }
        }
        resolve(undefined);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const getImageByName = useCallback((name) => {
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = (e) => {
        for (const note of e.target.result) {
          if (Array.isArray(note.assets)) {
            const found = note.assets.find(a => a.name === name);
            if (found) { resolve({ ...found, noteId: note.id }); return; }
          }
        }
        resolve(undefined);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  // Update or insert an asset inside the parent note's assets array.
  const upsertDriveImage = useCallback(async (driveFile, blob, noteId) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    if (!blob) return Promise.resolve('skipped');
    if (!noteId) return Promise.resolve('skipped');

    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      const os = tx.objectStore(NOTES_STORE);
      const req = os.get(noteId);
      req.onsuccess = () => {
        const note = req.result;
        if (!note) { resolve('skipped'); return; }
        const assets = Array.isArray(note.assets) ? [...note.assets] : [];
        const idx = assets.findIndex(a => a.driveId === driveFile.driveId || a.name === driveFile.name);
        const updated = { name: driveFile.name, data: blob, type: driveFile.mimeType, driveId: driveFile.driveId };
        const action = idx >= 0 ? 'updated' : 'added';
        if (idx >= 0) assets[idx] = updated; else assets.push(updated);
        const putReq = os.put({ ...note, assets });
        putReq.onsuccess = () => resolve(action);
        putReq.onerror   = (e) => reject(e.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  /** Persist the Drive folder ID and per-asset Drive file IDs back onto the note record. */
  const setNoteFolderData = useCallback((noteId, folderId, assetDriveIds, { silent = false } = {}) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      const os = tx.objectStore(NOTES_STORE);
      const req = os.get(noteId);
      req.onsuccess = () => {
        const note = req.result;
        if (!note) { resolve(); return; }
        const assets = Array.isArray(note.assets) ? note.assets.map(a => {
          const match = (assetDriveIds || []).find(ad => ad.name === a.name);
          return match ? { ...a, driveId: match.driveId } : a;
        }) : [];
        const putReq = os.put({ ...note, driveFolderId: folderId, assets });
        putReq.onsuccess = () => { if (!silent) loadItems('setNoteFolderData'); resolve(); };
        putReq.onerror   = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, [db, loadItems]);

  const getNotes = useCallback(() => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const deleteImagesForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve();
    // Clear legacy images store records for this note.
    const clearLegacy = () => new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readwrite');
      const request = tx.objectStore(IMAGES_STORE).index('noteId').openCursor(IDBKeyRange.only(noteId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); } else resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
    // assets embedded in the note record are removed when the note itself is deleted — no extra step needed.
    return clearLegacy();
  }, [db]);

  const deleteItem = useCallback((id, type) => {
    if (!db) return Promise.resolve();
    const store = storeForType(type);
    const isPdf = String(type || '').trim() === 'application/pdf';
    return deleteImagesForNote(id).then(() => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const deleteRequest = tx.objectStore(store).delete(id);
      deleteRequest.onsuccess = () => {
        loadItems('deleteItem');
        if (isPdf) {
          try {
            const tx2 = db.transaction(PDF_ANNOTATIONS_STORE, 'readwrite');
            tx2.objectStore(PDF_ANNOTATIONS_STORE).delete(pdfAnnotationSidecarKey(id, store));
          } catch {
            /* store may not exist on very old DB */
          }
        }
        resolve();
      };
      deleteRequest.onerror   = (e) => { console.error('Error deleting item:', e.target.error); reject(e.target.error); };
    }));
  }, [db, loadItems, deleteImagesForNote]);

  const clearAll = useCallback(() => {
    if (!db) return;
    // Close the active connection so the delete request isn't blocked.
    db.close();
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => window.location.reload();
    req.onerror   = (e) => console.error('Error deleting database:', e.target.error);
    req.onblocked = () => console.warn('[InfoDepo] deleteDatabase blocked — close other tabs and reload.');
  }, [db]);

  /**
   * Update driveId and optional sync times after a successful Drive upload or PATCH.
   * @param {object} [syncMeta] - If `modifiedTime` is set (ISO string from Drive), sets both modifiedTime and localModifiedAt to match Drive.
   */
  const setItemDriveId = useCallback((id, storeName, driveId, syncMeta = null) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    const silent = syncMeta?.silent ?? false;
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(storeName, 'readwrite'); } catch (err) { reject(err); return; }
      const os = tx.objectStore(storeName);
      const getRequest = os.get(id);
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) { reject(new Error('Record not found')); return; }
        const mt = syncMeta?.modifiedTime != null ? new Date(syncMeta.modifiedTime) : undefined;
        const putRequest = os.put({
          ...existing,
          driveId,
          ...(mt
            ? { modifiedTime: mt, localModifiedAt: mt }
            : {}),
        });
        putRequest.onsuccess = () => {
          if (!silent) { if (storeName === CHANNELS_STORE) loadChannels('setItemDriveId'); else loadItems('setItemDriveId'); }
          resolve();
        };
        putRequest.onerror   = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }, [db, loadItems, loadChannels]);

  // --- Drive sync operations (books + notes stores) ---

  const getBookByDriveId = useCallback((driveId) => {
    if (!db || !driveId) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([BOOKS_STORE, NOTES_STORE, VIDEOS_STORE], 'readonly');
      let pending = 3;
      let bHit, nHit, vHit;
      const finish = () => { pending--; if (pending === 0) resolve(bHit || nHit || vHit); };
      const bReq = tx.objectStore(BOOKS_STORE).index('driveId').get(driveId);
      bReq.onsuccess = () => { bHit = bReq.result; finish(); };
      bReq.onerror   = (e) => reject(e.target.error);
      const nReq = tx.objectStore(NOTES_STORE).index('driveId').get(driveId);
      nReq.onsuccess = () => { nHit = nReq.result; finish(); };
      nReq.onerror   = (e) => reject(e.target.error);
      const vReq = tx.objectStore(VIDEOS_STORE).index('driveId').get(driveId);
      vReq.onsuccess = () => { vHit = vReq.result; finish(); };
      vReq.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const getBookByName = useCallback((name) => {
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([BOOKS_STORE, NOTES_STORE, VIDEOS_STORE], 'readonly');
      let pending = 3;
      let booksList, notesList, videosList;
      const finish = () => {
        pending--;
        if (pending > 0) return;
        resolve(
          (booksList && booksList.find((b) => b.name === name))
          || (notesList && notesList.find((b) => b.name === name))
          || (videosList && videosList.find((b) => b.name === name))
        );
      };
      const bReq = tx.objectStore(BOOKS_STORE).getAll();
      bReq.onsuccess = (e) => { booksList = e.target.result; finish(); };
      bReq.onerror   = (e) => reject(e.target.error);
      const nReq = tx.objectStore(NOTES_STORE).getAll();
      nReq.onsuccess = (e) => { notesList = e.target.result; finish(); };
      nReq.onerror   = (e) => reject(e.target.error);
      const vReq = tx.objectStore(VIDEOS_STORE).getAll();
      vReq.onsuccess = (e) => { videosList = e.target.result; finish(); };
      vReq.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  // assets (optional): array of { name, data, type, driveId } to embed in the note record.
  // driveFile may carry driveFolderId for note bundles synced from Drive subfolders.
  const upsertDriveBook = useCallback(async (driveFile, blob, assets, { silent = false } = {}) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    if (!blob) return Promise.resolve('skipped'); // no-blob stubs no longer supported
    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const targetStore = existing
      ? storeForType(existing.type)
      : driveFile.mimeType === 'text/markdown'        ? NOTES_STORE
      : driveFile.mimeType === 'application/x-youtube' ? VIDEOS_STORE
      : BOOKS_STORE;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(targetStore, 'readwrite');
      const os = tx.objectStore(targetStore);

      if (existing) {
        const mt = driveFile.modifiedTime ? new Date(driveFile.modifiedTime) : new Date();
        const updated = {
          ...existing,
          driveId: driveFile.driveId,
          modifiedTime: mt,
          localModifiedAt: mt,
          data: blob, size: blob.size,
          tags: Array.isArray(existing.tags) ? existing.tags : [],
          ...(driveFile.driveFolderId ? { driveFolderId: driveFile.driveFolderId } : {}),
          ...(Array.isArray(assets) ? { assets } : {}),
        };
        const putRequest = os.put(updated);
        putRequest.onsuccess = () => { if (!silent) loadItems('upsertDriveBook/updated'); resolve('updated'); };
        putRequest.onerror   = (e) => reject(e.target.error);
      } else {
        const mtNew = driveFile.modifiedTime ? new Date(driveFile.modifiedTime) : new Date();
        const record = {
          name: driveFile.name, type: driveFile.mimeType,
          data: blob, size: blob.size,
          driveId: driveFile.driveId,
          modifiedTime: mtNew,
          localModifiedAt: mtNew,
          tags: [],
          ...(driveFile.driveFolderId ? { driveFolderId: driveFile.driveFolderId } : {}),
          ...(Array.isArray(assets) ? { assets } : {}),
        };
        const addRequest = os.add(record);
        addRequest.onsuccess = () => { if (!silent) loadItems('upsertDriveBook/added'); resolve('added'); };
        addRequest.onerror   = (e) => reject(e.target.error);
      }
    });
  }, [db, loadItems, getBookByDriveId, getBookByName]);

  // --- Channel operations ---

  const addChannel = useCallback((record) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(CHANNELS_STORE, 'readwrite'); } catch (err) { reject(err); return; }
      const os = tx.objectStore(CHANNELS_STORE);
      const now = new Date();
      const normalizedTags = normalizeTagsList(record.tags);
      const existingByChannelReq = os.index('channelId').get(record.channelId);

      existingByChannelReq.onsuccess = () => {
        const existing = existingByChannelReq.result;
        if (existing) {
          const putReq = os.put({
            ...existing,
            ...record,
            tags: normalizedTags.length ? normalizedTags : (Array.isArray(existing.tags) ? existing.tags : []),
            // Preserve existing Drive linkage when re-importing the same channel locally.
            driveId: existing.driveId || '',
            modifiedTime: now,
            localModifiedAt: now,
          });
          putReq.onsuccess = () => { loadChannels('addChannel/updated'); resolve('updated'); };
          putReq.onerror = (e) => reject(e.target.error);
          return;
        }

        const addReq = os.add({
          ...record,
          tags: normalizedTags,
          driveId: '',
          modifiedTime: now,
          localModifiedAt: now,
        });
        addReq.onsuccess = () => { loadChannels('addChannel/added'); resolve('added'); };
        addReq.onerror = (e) => reject(e.target.error);
      };
      existingByChannelReq.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadChannels]);

  const deleteChannel = useCallback((id) => {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHANNELS_STORE, 'readwrite');
      const req = tx.objectStore(CHANNELS_STORE).delete(id);
      req.onsuccess = () => {
        loadChannels('deleteChannel');
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadChannels]);

  const updateChannel = useCallback((id, data) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHANNELS_STORE, 'readwrite');
      const os = tx.objectStore(CHANNELS_STORE);
      const getReq = os.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) { reject(new Error('Channel not found')); return; }
        const putReq = os.put({ ...existing, ...data, localModifiedAt: new Date() });
        putReq.onsuccess = () => { loadChannels('updateChannel'); resolve(); };
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadChannels]);

  const getChannelByDriveId = useCallback((driveId) => {
    if (!db || !driveId) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHANNELS_STORE, 'readonly');
      const req = tx.objectStore(CHANNELS_STORE).getAll();
      req.onsuccess = (e) => resolve(e.target.result.find(c => c.driveId === driveId));
      req.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const upsertDriveChannel = useCallback(async (driveFile, channelData, { silent = false } = {}) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    let existing = await getChannelByDriveId(driveFile.driveId);
    if (!existing) {
      // fall back to matching by channelId
      existing = await new Promise((resolve, reject) => {
        const tx = db.transaction(CHANNELS_STORE, 'readonly');
        const req = tx.objectStore(CHANNELS_STORE).index('channelId').get(channelData.channelId);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHANNELS_STORE, 'readwrite');
      const os = tx.objectStore(CHANNELS_STORE);
      if (existing) {
        const driveIsNewer = !existing.modifiedTime ||
          new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime);
        if (!driveIsNewer) { resolve('skipped'); return; }
        const mtCh = new Date(driveFile.modifiedTime);
        const putReq = os.put({
          ...existing,
          ...channelData,
          tags: Array.isArray(channelData.tags)
            ? normalizeTagsList(channelData.tags)
            : (Array.isArray(existing.tags) ? existing.tags : []),
          driveId: driveFile.driveId,
          modifiedTime: mtCh,
          localModifiedAt: mtCh,
        });
        putReq.onsuccess = () => { if (!silent) loadChannels('upsertDriveChannel/updated'); resolve('updated'); };
        putReq.onerror = (e) => reject(e.target.error);
      } else {
        const mtAdd = new Date(driveFile.modifiedTime);
        const addReq = os.add({
          ...channelData,
          tags: normalizeTagsList(channelData.tags),
          driveId: driveFile.driveId,
          modifiedTime: mtAdd,
          localModifiedAt: mtAdd,
        });
        addReq.onsuccess = () => { if (!silent) loadChannels('upsertDriveChannel/added'); resolve('added'); };
        addReq.onerror = (e) => reject(e.target.error);
      }
    });
  }, [db, loadChannels, getChannelByDriveId]);

  /**
   * Persist a share config from Drive (`*.share.json`) into the `shares` store.
   * @returns {Promise<'added'|'updated'|'skipped'>}
   */
  const upsertDriveShare = useCallback(
    async (driveFile, text, options = {}) => {
      if (!db) return Promise.reject(new Error('Database not initialized'));
      const payload = parseSharesDriveJsonText(text);
      if (!payload) return 'skipped';

      let existing = await getShareByDriveFileId(driveFile.driveId);
      if (!existing && payload.localId) {
        existing = await getShareById(payload.localId);
      }

      const role = existing?.role ?? options.role ?? 'owner';
      const id =
        existing?.id ||
        payload.localId ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `share-${Date.now()}`);
      const rec = payloadToClientRecord(id, payload, role, driveFile.driveId);

      const silent = options.silent ?? false;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SHARES_STORE, 'readwrite');
        const putReq = tx.objectStore(SHARES_STORE).put(rec);
        putReq.onsuccess = () => {
          if (!silent) loadShares('upsertDriveShare');
          resolve(existing ? 'updated' : 'added');
        };
        putReq.onerror = () => reject(putReq.error);
      });
    },
    [db, loadShares, getShareByDriveFileId, getShareById]
  );

  const setRecordTags = useCallback((id, storeName, tags) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    const normalized = normalizeTagsList(tags);
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(storeName, 'readwrite'); } catch (err) { reject(err); return; }
      const os = tx.objectStore(storeName);
      const getReq = os.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) { reject(new Error('Record not found')); return; }
        const putReq = os.put({ ...existing, tags: normalized, localModifiedAt: new Date() });
        putReq.onsuccess = () => {
          if (storeName === CHANNELS_STORE) loadChannels('setRecordTags');
          else if (storeName !== IMAGES_STORE) loadItems('setRecordTags');
          resolve();
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }, [db, loadItems, loadChannels]);

  const renameItem = useCallback((id, storeName, nextName) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    const name = String(nextName || '').trim();
    if (!name) return Promise.reject(new Error('Name cannot be empty'));
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(storeName, 'readwrite'); } catch (err) { reject(err); return; }
      const os = tx.objectStore(storeName);
      const getReq = os.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) { reject(new Error('Record not found')); return; }
        const putReq = os.put({ ...existing, name, localModifiedAt: new Date() });
        putReq.onsuccess = () => {
          if (storeName === CHANNELS_STORE) loadChannels('renameItem');
          else if (storeName !== IMAGES_STORE) loadItems('renameItem');
          resolve();
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }, [db, loadItems, loadChannels]);

  const setItemReadingPosition = useCallback((id, storeName, readingPosition) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    if (!id) return Promise.reject(new Error('Record id is required'));

    const candidates = [
      storeName,
      BOOKS_STORE,
      NOTES_STORE,
      VIDEOS_STORE,
    ].filter((s, idx, arr) => s && arr.indexOf(s) === idx);

    const tryStore = (index) =>
      new Promise((resolve, reject) => {
        if (index >= candidates.length) {
          reject(new Error('Record not found in candidate stores'));
          return;
        }
        const targetStore = candidates[index];
        let tx;
        try { tx = db.transaction(targetStore, 'readwrite'); } catch (err) { reject(err); return; }
        const os = tx.objectStore(targetStore);
        const getReq = os.get(id);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) {
            tryStore(index + 1).then(resolve).catch(reject);
            return;
          }
          let nextReadingPosition = readingPosition;
          if (readingPosition && readingPosition.kind === 'pdf' && readingPosition.pdfAnnotations != null) {
            const { pdfAnnotations: _legacyAnn, ...rest } = readingPosition;
            nextReadingPosition = rest;
          }
          const putReq = os.put({ ...existing, readingPosition: nextReadingPosition });
          putReq.onsuccess = () => {
            if (targetStore === CHANNELS_STORE) {
              setChannels((prev) =>
                prev.map((rec) => (rec.id === id ? { ...rec, readingPosition: nextReadingPosition } : rec))
              );
            } else if (targetStore !== IMAGES_STORE) {
              setItems((prev) =>
                prev.map((rec) => (rec.id === id ? { ...rec, readingPosition: nextReadingPosition } : rec))
              );
            }
            resolve();
          };
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });

    return tryStore(0);
  }, [db]);

  const getPdfAnnotationSidecar = useCallback((itemId, idbStore) => {
    if (!db || itemId == null || !idbStore) return Promise.resolve(null);
    const sidecarKey = pdfAnnotationSidecarKey(itemId, idbStore);
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(PDF_ANNOTATIONS_STORE, 'readonly'); }
      catch (err) { resolve(null); return; }
      const req = tx.objectStore(PDF_ANNOTATIONS_STORE).get(sidecarKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }, [db]);

  const putPdfAnnotationsForItem = useCallback((itemId, idbStore, annotations, pdfDriveId = '') => {
    if (!db || itemId == null || !idbStore) return Promise.reject(new Error('Database not initialized'));
    const sidecarKey = pdfAnnotationSidecarKey(itemId, idbStore);
    const now = new Date();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(PDF_ANNOTATIONS_STORE, 'readwrite'); }
      catch (err) { reject(err); return; }
      const os = tx.objectStore(PDF_ANNOTATIONS_STORE);
      const g = os.get(sidecarKey);
      g.onsuccess = () => {
        const prev = g.result;
        const pdfD = String(pdfDriveId || '').trim() || (prev && String(prev.pdfDriveId || '').trim()) || '';
        const rec = {
          sidecarKey,
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
  }, [db]);

  const setPdfAnnotationDriveSync = useCallback((itemId, idbStore, { annotationDriveId, modifiedTime, pdfDriveId } = {}) => {
    if (!db || itemId == null || !idbStore) return Promise.reject(new Error('Database not initialized'));
    const sidecarKey = pdfAnnotationSidecarKey(itemId, idbStore);
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(PDF_ANNOTATIONS_STORE, 'readwrite'); }
      catch (err) { reject(err); return; }
      const os = tx.objectStore(PDF_ANNOTATIONS_STORE);
      const g = os.get(sidecarKey);
      g.onsuccess = () => {
        const prev = g.result || {
          sidecarKey,
          itemId,
          idbStore,
          pdfDriveId: '',
          annotations: [],
          version: 1,
          annotationDriveId: '',
          modifiedTime: '',
          localModifiedAt: new Date(),
        };
        const rec = { ...prev };
        if (pdfDriveId != null && String(pdfDriveId).trim() !== '') {
          rec.pdfDriveId = String(pdfDriveId).trim();
        }
        if (annotationDriveId != null && String(annotationDriveId).trim() !== '') {
          rec.annotationDriveId = String(annotationDriveId).trim();
        }
        if (modifiedTime != null && String(modifiedTime).trim() !== '') {
          rec.modifiedTime = modifiedTime;
          rec.localModifiedAt = new Date(modifiedTime);
        }
        const p = os.put(rec);
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  }, [db]);

  const upsertDrivePdfAnnotation = useCallback((driveFile, text) => {
    if (!db) return Promise.resolve('skipped');
    const payload = parsePdfAnnotationSidecarText(text);
    if (!payload) return Promise.resolve('skipped');

    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction([BOOKS_STORE, NOTES_STORE], 'readonly'); }
      catch (err) { resolve('skipped'); return; }

      const findPdfRow = (storeName) =>
        new Promise((res, rej) => {
          const ix = tx.objectStore(storeName).index('driveId');
          const r = ix.getAll(payload.pdfDriveId);
          r.onsuccess = () => {
            const rows = r.result || [];
            res(rows.find((row) => row && row.type === 'application/pdf') || null);
          };
          r.onerror = () => rej(r.error);
        });

      Promise.all([findPdfRow(BOOKS_STORE), findPdfRow(NOTES_STORE)])
        .then(([fromBooks, fromNotes]) => {
          const book = fromBooks || fromNotes;
          const idbStore = fromBooks ? BOOKS_STORE : NOTES_STORE;
          if (!book) {
            resolve('skipped');
            return;
          }
          const sk = pdfAnnotationSidecarKey(book.id, idbStore);
          let tw;
          try { tw = db.transaction(PDF_ANNOTATIONS_STORE, 'readwrite'); }
          catch (e) { resolve('skipped'); return; }
          const os = tw.objectStore(PDF_ANNOTATIONS_STORE);
          const g = os.get(sk);
          g.onsuccess = () => {
            const existing = g.result;
            if (
              existing &&
              sidecarTimeMs(existing.localModifiedAt) != null &&
              sidecarTimeMs(existing.modifiedTime) != null &&
              sidecarTimeMs(existing.localModifiedAt) > sidecarTimeMs(existing.modifiedTime)
            ) {
              resolve('skipped');
              return;
            }
            const driveNewer =
              !existing?.modifiedTime ||
              new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime);
            if (existing && !driveNewer) {
              resolve('skipped');
              return;
            }
            const rec = {
              sidecarKey: sk,
              itemId: book.id,
              idbStore,
              pdfDriveId: payload.pdfDriveId,
              annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
              version: payload.version || 1,
              annotationDriveId: driveFile.driveId,
              modifiedTime: driveFile.modifiedTime,
              localModifiedAt: new Date(driveFile.modifiedTime),
            };
            const p = os.put(rec);
            p.onsuccess = () => resolve(existing ? 'updated' : 'added');
            p.onerror = () => reject(p.error);
          };
          g.onerror = () => reject(g.error);
        })
        .catch(reject);
    });
  }, [db]);

  return {
    items, channels, shares, isInitialized,
    addItem, updateItem, deleteItem, clearAll,
    addImage, getImagesForNote, getAllImages,
    getImageByDriveId, getImageByName, upsertDriveImage, getNotes,
    setItemDriveId, setNoteFolderData,
    addChannel, deleteChannel, updateChannel,
    getChannelByDriveId, upsertDriveChannel,
    getBookByDriveId, getBookByName, upsertDriveBook,
    getShareById, getShareByDriveFileId, upsertDriveShare,
    setRecordTags,
    renameItem,
    setItemReadingPosition,
    getPdfAnnotationSidecar,
    putPdfAnnotationsForItem,
    setPdfAnnotationDriveSync,
    upsertDrivePdfAnnotation,
    getMergedLibraryItems,
    loadItems, loadChannels, loadShares,
    getSharesList,
    addShare,
    updateShare,
    deleteShare,
  };
};
