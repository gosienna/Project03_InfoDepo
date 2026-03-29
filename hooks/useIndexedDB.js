
import { useState, useEffect, useCallback } from 'react';

const DB_NAME = 'InfoDepo';
const DB_VERSION = 1;
const STORE_NAME = 'books';

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
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
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

  const deleteBook = useCallback((id) => {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const deleteRequest = objectStore.delete(id);
    
    deleteRequest.onsuccess = () => {
        loadBooks();
    };
     deleteRequest.onerror = (event) => {
        console.error('Error deleting book:', event.target.error);
    };
  }, [db, loadBooks]);

  const clearBooks = useCallback(() => {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const clearRequest = objectStore.clear();

    clearRequest.onsuccess = () => {
        setBooks([]);
    };
     clearRequest.onerror = (event) => {
        console.error('Error clearing books:', event.target.error);
    };
  }, [db]);

  return { db, books, addBook, deleteBook, clearBooks, isInitialized };
};