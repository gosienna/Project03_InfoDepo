
import { useState, useEffect, useCallback } from 'react';

const DB_NAME = 'InfoDepo';
const DB_VERSION = 3;
const STORE_NAME = 'books';
const ASSETS_STORE = 'assets';

export const useIndexedDB = () => {
  const [db, setDb] = useState(null);
  const [books, setBooks] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const initDB = useCallback(() => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      setIsInitialized(true); // Still allow app to run
    };

    request.onsuccess = (event) => {
      const dbInstance = event.target.result;
      setDb(dbInstance);
      setIsInitialized(true);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (oldVersion < 2) {
        if (!dbInstance.objectStoreNames.contains(ASSETS_STORE)) {
          const assetStore = dbInstance.createObjectStore(ASSETS_STORE, { keyPath: 'id', autoIncrement: true });
          assetStore.createIndex('noteId', 'noteId', { unique: false });
        }
      }
      if (oldVersion < 3) {
        // Add driveId index for O(1) lookup during sync
        const booksStore = event.target.transaction.objectStore(STORE_NAME);
        if (!booksStore.indexNames.contains('driveId')) {
          booksStore.createIndex('driveId', 'driveId', { unique: false });
        }
      }
    };
  }, []);

  useEffect(() => {
    initDB();
  }, [initDB]);

  const loadBooks = useCallback(() => {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const getAllRequest = objectStore.getAll();

    getAllRequest.onsuccess = (event) => {
      const result = event.target.result;
      setBooks(result.sort((a,b) => b.added.getTime() - a.added.getTime()));
    };
    getAllRequest.onerror = (event) => {
      console.error('Error fetching books:', event.target.error);
    };
  }, [db]);

  useEffect(() => {
    if (isInitialized) {
        loadBooks();
    }
  }, [isInitialized, loadBooks]);

  const addBook = useCallback(async (name, type, data) => {
    if (!db) {
        console.error('Database not initialized');
        return;
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        const bookData = {
            name,
            type,
            data,
            size: data.size,
            added: new Date(),
        };
        const addRequest = objectStore.add(bookData);

        addRequest.onsuccess = () => {
            loadBooks();
            resolve();
        };

        addRequest.onerror = (event) => {
            console.error('Error adding book:', event.target.error);
            reject(event.target.error);
        };
    });
  }, [db, loadBooks]);

  const updateBook = useCallback((id, content) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const getRequest = objectStore.get(id);
      getRequest.onsuccess = (event) => {
        const existing = event.target.result;
        if (!existing) { reject(new Error('Book not found')); return; }
        const updated = { ...existing, data: content, size: content.size };
        const putRequest = objectStore.put(updated);
        putRequest.onsuccess = () => { loadBooks(); resolve(); };
        putRequest.onerror = (e) => reject(e.target.error);
      };
      getRequest.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadBooks]);

  const addAsset = useCallback((noteId, filename, data, mimeType) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ASSETS_STORE, 'readwrite');
      const objectStore = transaction.objectStore(ASSETS_STORE);
      const addRequest = objectStore.add({ noteId, filename, data, mimeType });
      addRequest.onsuccess = (event) => resolve(event.target.result);
      addRequest.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const getAssetsForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ASSETS_STORE, 'readonly');
      const index = transaction.objectStore(ASSETS_STORE).index('noteId');
      const request = index.getAll(IDBKeyRange.only(noteId));
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const deleteAssetsForNote = useCallback((noteId) => {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ASSETS_STORE, 'readwrite');
      const index = transaction.objectStore(ASSETS_STORE).index('noteId');
      const request = index.openCursor(IDBKeyRange.only(noteId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
        else resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const deleteBook = useCallback((id) => {
    if (!db) return Promise.resolve();
    return deleteAssetsForNote(id).then(() => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const deleteRequest = objectStore.delete(id);
      deleteRequest.onsuccess = () => { loadBooks(); resolve(); };
      deleteRequest.onerror = (event) => {
        console.error('Error deleting book:', event.target.error);
        reject(event.target.error);
      };
    }));
  }, [db, loadBooks, deleteAssetsForNote]);

  const clearBooks = useCallback(() => {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME, ASSETS_STORE], 'readwrite');
    transaction.objectStore(ASSETS_STORE).clear();
    const clearRequest = transaction.objectStore(STORE_NAME).clear();
    clearRequest.onsuccess = () => { setBooks([]); };
    clearRequest.onerror = (event) => {
      console.error('Error clearing books:', event.target.error);
    };
  }, [db]);

  // --- Drive sync operations ---

  const getBookByDriveId = useCallback((driveId) => {
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const index = transaction.objectStore(STORE_NAME).index('driveId');
      const request = index.get(driveId);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  const getBookByName = useCallback((name) => {
    if (!db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = (event) => resolve(event.target.result.find(b => b.name === name));
      request.onerror = (e) => reject(e.target.error);
    });
  }, [db]);

  // Adds a metadata-only stub (no blob) for a Drive file not yet downloaded
  const addMetadataBook = useCallback(({ name, type, size, driveId, driveModifiedTime }) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const record = {
        name,
        type,
        data: null,
        size: parseInt(size) || 0,
        added: new Date(),
        driveId,
        driveModifiedTime,
        isMetadataOnly: true,
      };
      const addRequest = objectStore.add(record);
      addRequest.onsuccess = () => { loadBooks(); resolve(); };
      addRequest.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadBooks]);

  // Upgrades a metadata-only record to a full record after user downloads
  const markAsDownloaded = useCallback((id, blob) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const getRequest = objectStore.get(id);
      getRequest.onsuccess = (event) => {
        const existing = event.target.result;
        if (!existing) { reject(new Error('Book not found')); return; }
        const updated = { ...existing, data: blob, size: blob.size, isMetadataOnly: false };
        const putRequest = objectStore.put(updated);
        putRequest.onsuccess = () => { loadBooks(); resolve(); };
        putRequest.onerror = (e) => reject(e.target.error);
      };
      getRequest.onerror = (e) => reject(e.target.error);
    });
  }, [db, loadBooks]);

  // Core sync primitive: create or update a Drive-linked book record
  const upsertDriveBook = useCallback(async (driveFile, blob) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));

    // Look up by driveId first, then by name as fallback
    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);

      if (existing) {
        const updated = {
          ...existing,
          driveId: driveFile.driveId,
          driveModifiedTime: driveFile.driveModifiedTime,
          ...(blob ? { data: blob, size: blob.size, isMetadataOnly: false } : {}),
        };
        const putRequest = objectStore.put(updated);
        putRequest.onsuccess = () => { loadBooks(); resolve('updated'); };
        putRequest.onerror = (e) => reject(e.target.error);
      } else {
        const record = {
          name: driveFile.name,
          type: driveFile.mimeType,
          data: blob || null,
          size: blob ? blob.size : (parseInt(driveFile.size) || 0),
          added: new Date(driveFile.driveModifiedTime || Date.now()),
          driveId: driveFile.driveId,
          driveModifiedTime: driveFile.driveModifiedTime,
          isMetadataOnly: !blob,
        };
        const addRequest = objectStore.add(record);
        addRequest.onsuccess = () => { loadBooks(); resolve('added'); };
        addRequest.onerror = (e) => reject(e.target.error);
      }
    });
  }, [db, loadBooks, getBookByDriveId, getBookByName]);

  // Converts fully-downloaded Drive books to metadata stubs to free up storage
  const evictToMetadata = useCallback((bookIds) => {
    if (!db) return Promise.reject(new Error('Database not initialized'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      let pending = bookIds.length;
      if (pending === 0) { loadBooks(); resolve(); return; }

      bookIds.forEach((id) => {
        const getRequest = objectStore.get(id);
        getRequest.onsuccess = (event) => {
          const existing = event.target.result;
          if (!existing) { pending--; if (pending === 0) { loadBooks(); resolve(); } return; }
          const updated = { ...existing, data: null, isMetadataOnly: true };
          const putRequest = objectStore.put(updated);
          putRequest.onsuccess = () => {
            pending--;
            if (pending === 0) { loadBooks(); resolve(); }
          };
          putRequest.onerror = (e) => reject(e.target.error);
        };
        getRequest.onerror = (e) => reject(e.target.error);
      });
    });
  }, [db, loadBooks]);

  return {
    db, books, addBook, updateBook, deleteBook, clearBooks, isInitialized,
    addAsset, getAssetsForNote,
    // Drive sync
    getBookByDriveId, getBookByName, addMetadataBook, markAsDownloaded,
    upsertDriveBook, evictToMetadata,
  };
};
