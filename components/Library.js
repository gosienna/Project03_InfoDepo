
import React, { useRef, useState } from 'react';
import { BookCard } from './BookCard.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { DevDriveBrowser } from './DevDriveBrowser.js';

const IS_DEV = import.meta.env.DEV;

export const Library = ({ books, onSelectBook, onAddBook, onDeleteBook, onClearLibrary }) => {
  const fileInputRef = useRef(null);
  const [isDevBrowserOpen, setIsDevBrowserOpen] = useState(false);

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
          "button",
          {
            onClick: () => setIsDevBrowserOpen(true),
            className: "flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-bold py-2 px-5 rounded-xl transition-all active:scale-95",
            title: "Load from test Drive folder (dev only)"
          },
          React.createElement("span", null, "DEV: Test Folder")
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
            React.createElement(BookCard, { key: book.id, book: book, onSelect: onSelectBook, onDelete: onDeleteBook })
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
