
import React, { useRef, useState, useEffect } from 'react';
import { BookCard } from './BookCard.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { DevDriveBrowser } from './DevDriveBrowser.js';

const IS_DEV    = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
                  || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const FOLDER_ID = import.meta.env?.VITE_TEST_DRIVE_FOLDER_ID;
const API_KEY   = import.meta.env?.VITE_TEST_API_KEY;
const CLIENT_ID = import.meta.env?.VITE_TEST_CLIENT_ID;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const Library = ({ books, onSelectBook, onAddBook, onDeleteBook, onClearLibrary }) => {
  const fileInputRef   = useRef(null);
  const uploadTokenRef = useRef(null);   // cached OAuth token for uploads
  const [isDevBrowserOpen, setIsDevBrowserOpen] = useState(false);
  const [driveFolderName, setDriveFolderName]   = useState(null);
  const [uploadStatuses, setUploadStatuses]     = useState({});  // { [bookId]: 'uploading'|'success'|'error' }

  useEffect(() => {
    if (!IS_DEV || !FOLDER_ID || !API_KEY || !API_KEY.startsWith('AIza')) return;
    fetch(`https://www.googleapis.com/drive/v3/files/${FOLDER_ID}?fields=name&key=${API_KEY}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.name) setDriveFolderName(data.name); })
      .catch(() => {});
  }, []);

  const setStatus = (id, status) =>
    setUploadStatuses(prev => ({ ...prev, [id]: status }));

  const getUploadToken = () =>
    new Promise((resolve, reject) => {
      if (uploadTokenRef.current) { resolve(uploadTokenRef.current); return; }
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google API not loaded')); return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
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
        ...(FOLDER_ID ? { parents: [FOLDER_ID] } : {}),
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
      uploadTokenRef.current = null;  // clear token so next attempt re-authenticates
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

  return React.createElement(
    React.Fragment,
    null,
    // Toolbar
    React.createElement(
      "div",
      { className: "flex items-center justify-between mb-6" },
      React.createElement(
        "h2",
        { className: "text-3xl font-bold text-gray-100" },
        "My Library"
      ),
      React.createElement(
        "div",
        { className: "flex items-center gap-2" },
        React.createElement(
          "span",
          { className: "text-sm text-gray-500 font-medium bg-gray-800 px-3 py-1 rounded-full border border-gray-700" },
          books.length,
          " ",
          books.length === 1 ? 'Book' : 'Books'
        ),
        IS_DEV && React.createElement(
          "div",
          { className: "flex items-center gap-1.5" },
          React.createElement(
            "button",
            {
              onClick: () => setIsDevBrowserOpen(true),
              className: "flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-bold py-2 px-5 rounded-xl transition-all active:scale-95",
              title: "Load from test Drive folder (dev only)"
            },
            React.createElement("span", null, "DEV: Test Folder")
          ),
          driveFolderName && React.createElement(
            "span",
            {
              className: "flex items-center gap-1 bg-gray-800 border border-yellow-500/40 text-yellow-400 text-xs font-mono px-2.5 py-1.5 rounded-lg",
              title: `Linked Drive folder: ${driveFolderName}`
            },
            React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", className: "h-3 w-3 shrink-0", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M3 7a2 2 0 012-2h3.586a1 1 0 01.707.293L11 7h10a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" })
            ),
            driveFolderName
          )
        ),
        React.createElement(
          "button",
          {
            onClick: () => fileInputRef.current?.click(),
            className: "flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-5 rounded-xl transition-all shadow-lg shadow-indigo-500/10 active:scale-95"
          },
          React.createElement(BookIcon, { className: "h-5 w-5" }),
          React.createElement("span", null, "Add Book")
        ),
        books.length > 0 &&
          React.createElement(
            "button",
            {
              onClick: handleConfirmClear,
              className: "bg-red-900/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-900/50 p-2.5 rounded-xl transition-all",
              title: "Clear Library"
            },
            React.createElement(TrashIcon, { className: "h-5 w-5" })
          ),
        React.createElement("input", {
          ref: fileInputRef,
          type: "file",
          accept: ".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain",
          onChange: handleFileChange,
          className: "hidden"
        })
      )
    ),
    // Book grid or empty state
    books.length > 0
      ? React.createElement(
          "div",
          { className: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6" },
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
          "div",
          { className: "text-center py-20 px-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20" },
          React.createElement(
            "div",
            { className: "bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-700" },
            React.createElement(BookIcon, { className: "h-8 w-8 text-gray-600" })
          ),
          React.createElement(
            "h3",
            { className: "text-xl font-semibold text-gray-400" },
            "Library is Empty"
          ),
          React.createElement(
            "p",
            { className: "text-gray-500 mt-2 max-w-sm mx-auto" },
            "Click \"Add Book\" to import an EPUB, PDF, or TXT file from your device."
          ),
          React.createElement(
            "button",
            {
              onClick: () => fileInputRef.current?.click(),
              className: "mt-6 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl transition-all"
            },
            React.createElement(BookIcon, { className: "h-5 w-5" }),
            "Add Your First Book"
          )
        ),
    IS_DEV && isDevBrowserOpen && React.createElement(DevDriveBrowser, {
      onFileSelect: onAddBook,
      onClose: () => setIsDevBrowserOpen(false),
    })
  );
};
