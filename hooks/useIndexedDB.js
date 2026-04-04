
import { useState, useEffect, useCallback } from 'react';
import { INFO_DEPO_DB_NAME as DB_NAME, INFO_DEPO_DB_VERSION as DB_VERSION } from '../utils/infodepoDb.js';

const BOOKS_STORE  = 'books';
const NOTES_STORE  = 'notes';
const VIDEOS_STORE = 'videos';
const IMAGES_STORE = 'images';

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
  const t = rec?.modifiedTime;
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
        console.error(
          '[InfoDepo] IndexedDB was already at a higher version. Clear site data (Application → Storage) for this origin or delete the "InfoDepo" database, then reload.'
        );
      }
      setIsInitialized(true);
    };

    request.onsuccess = (event) => {
      setDb(event.target.result);
      setIsInitialized(true);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (event.oldVersion < 1) {
        const addStore = (name, indexSpec) => {
          const s = dbInstance.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          indexSpec.forEach(({ key, path, unique }) => s.createIndex(key, path, { unique }));
        };
        addStore(BOOKS_STORE,  [{ key: 'driveId', path: 'driveId', unique: false }]);
        addStore(NOTES_STORE,  [{ key: 'driveId', path: 'driveId', unique: false }]);
        addStore(VIDEOS_STORE, [{ key: 'driveId', path: 'driveId', unique: false }]);
        addStore(IMAGES_STORE, [{ key: 'noteId',  path: 'noteId',  unique: false }]);
      }
    };
  }, []);

  useEffect(() => { initDB(); }, [initDB]);

  const loadItems = useCallback(() => {
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
      const merged = [
        ...books.map((r) => ({ ...r, idbStore: BOOKS_STORE })),
        ...notes.map((r) => ({ ...r, idbStore: NOTES_STORE })),
        ...videos.map((r) => ({ ...r, idbStore: VIDEOS_STORE })),
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

  useEffect(() => {
    if (isInitialized) loadItems();
  }, [isInitialized, loadItems]);

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
      const record = { name, type: storedType, data, size, driveId: '', modifiedTime: new Date() };
      const addRequest = tx.objectStore(store).add(record);
      addRequest.onsuccess = () => { loadItems(); resolve(); };
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
          // Do NOT update modifiedTime here — it tracks the Drive sync version, not local edit time.
          // Advancing it on local saves would make Drive appear "older" and block future syncs.
          const putRequest = os.put({ ...existing, type: nextType, data: content, size });
          putRequest.onsuccess = () => { loadItems(); resolve(); };
          putRequest.onerror   = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });

    return tryStore(preferred, true);
  }, [db, loadItems]);

  const addImage = useCallback((noteId, name, data, type) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readwrite');
      const record = { noteId, name, data, type, size: blobLikeSize(data), driveId: '', modifiedTime: new Date() };
      const addRequest = tx.objectStore(IMAGES_STORE).add(record);
      addRequest.onsuccess = (e) => resolve(e.target.result);
      addRequest.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const getImagesForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const request = tx.objectStore(IMAGES_STORE).index('noteId').getAll(IDBKeyRange.only(noteId));
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const getAllImages = useCallback(() => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const request = tx.objectStore(IMAGES_STORE).getAll();
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const deleteImagesForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readwrite');
      const request = tx.objectStore(IMAGES_STORE).index('noteId').openCursor(IDBKeyRange.only(noteId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); } else resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const deleteItem = useCallback((id, type) => {
    if (!db) return Promise.resolve();
    const store = storeForType(type);
    return deleteImagesForNote(id).then(() => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const deleteRequest = tx.objectStore(store).delete(id);
      deleteRequest.onsuccess = () => { loadItems(); resolve(); };
      deleteRequest.onerror   = (e) => { console.error('Error deleting item:', e.target.error); reject(e.target.error); };
    }));
  }, [db, loadItems, deleteImagesForNote]);

  const clearAll = useCallback(() => {
    if (!db) return;
    const tx = db.transaction([BOOKS_STORE, NOTES_STORE, VIDEOS_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(IMAGES_STORE).clear();
    tx.objectStore(VIDEOS_STORE).clear();
    tx.objectStore(NOTES_STORE).clear();
    const clearReq = tx.objectStore(BOOKS_STORE).clear();
    clearReq.onsuccess = () => setItems([]);
    clearReq.onerror   = (e) => console.error('Error clearing library:', e.target.error);
  }, [db]);

  /** Update the driveId on any store record after a successful Drive upload. */
  const setItemDriveId = useCallback((id, storeName, driveId) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(storeName, 'readwrite'); } catch (err) { reject(err); return; }
      const os = tx.objectStore(storeName);
      const getRequest = os.get(id);
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) { reject(new Error('Record not found')); return; }
        const putRequest = os.put({ ...existing, driveId });
        putRequest.onsuccess = () => { loadItems(); resolve(); };
        putRequest.onerror   = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }, [db, loadItems]);

  // --- Drive sync operations (books + notes stores) ---

  const getBookByDriveId = useCallback((driveId) => {
    if (!db || !driveId) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([BOOKS_STORE, NOTES_STORE], 'readonly');
      let pending = 2;
      let bHit, nHit;
      const finish = () => { pending--; if (pending === 0) resolve(bHit || nHit); };
      const bReq = tx.objectStore(BOOKS_STORE).index('driveId').get(driveId);
      bReq.onsuccess = () => { bHit = bReq.result; finish(); };
      bReq.onerror   = (e) => reject(e.target.error);
      const nReq = tx.objectStore(NOTES_STORE).index('driveId').get(driveId);
      nReq.onsuccess = () => { nHit = nReq.result; finish(); };
      nReq.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const getBookByName = useCallback((name) => {
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([BOOKS_STORE, NOTES_STORE], 'readonly');
      let pending = 2;
      let booksList, notesList;
      const finish = () => {
        pending--;
        if (pending > 0) return;
        resolve(
          (booksList && booksList.find((b) => b.name === name))
          || (notesList && notesList.find((b) => b.name === name))
        );
      };
      const bReq = tx.objectStore(BOOKS_STORE).getAll();
      bReq.onsuccess = (e) => { booksList = e.target.result; finish(); };
      bReq.onerror   = (e) => reject(e.target.error);
      const nReq = tx.objectStore(NOTES_STORE).getAll();
      nReq.onsuccess = (e) => { notesList = e.target.result; finish(); };
      nReq.onerror   = (e) => reject(e.target.error);
    });
  }, [db]);

  const upsertDriveBook = useCallback(async (driveFile, blob) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    if (!blob) return Promise.resolve('skipped'); // no-blob stubs no longer supported
    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const targetStore = existing
      ? storeForType(existing.type)
      : (driveFile.mimeType === 'text/markdown' ? NOTES_STORE : BOOKS_STORE);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(targetStore, 'readwrite');
      const os = tx.objectStore(targetStore);

      if (existing) {
        const updated = {
          ...existing,
          driveId: driveFile.driveId,
          modifiedTime: driveFile.modifiedTime ? new Date(driveFile.modifiedTime) : new Date(),
          data: blob, size: blob.size,
        };
        const putRequest = os.put(updated);
        putRequest.onsuccess = () => { loadItems(); resolve('updated'); };
        putRequest.onerror   = (e) => reject(e.target.error);
      } else {
        const record = {
          name: driveFile.name, type: driveFile.mimeType,
          data: blob, size: blob.size,
          driveId: driveFile.driveId,
          modifiedTime: driveFile.modifiedTime ? new Date(driveFile.modifiedTime) : new Date(),
        };
        const addRequest = os.add(record);
        addRequest.onsuccess = () => { loadItems(); resolve('added'); };
        addRequest.onerror   = (e) => reject(e.target.error);
      }
    });
  }, [db, loadItems, getBookByDriveId, getBookByName]);

  return {
    items, isInitialized,
    addItem, updateItem, deleteItem, clearAll,
    addImage, getImagesForNote, getAllImages,
    setItemDriveId,
    // Drive sync (books + notes)
    getBookByDriveId, getBookByName, upsertDriveBook,
  };
};
