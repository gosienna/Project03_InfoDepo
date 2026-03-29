
import React, { useState } from 'react';
import { Header } from './components/Header.js';
import { Library } from './components/Library.js';
import { Reader } from './components/Reader.js';
import { useIndexedDB } from './hooks/useIndexedDB.js';

const App = () => {
  const { books, addBook, deleteBook, clearBooks, isInitialized } = useIndexedDB();
  const [currentBook, setCurrentBook] = useState(null);
  const [view, setView] = useState('library');

  const handleSelectBook = (book) => {
    const ext = book.name.split('.').pop().toLowerCase();
    const mime = book.type || '';
    const isEpub = ext === 'epub' || mime === 'application/epub+zip';
    if (isEpub) {
      window.open(`/reader.html?id=${book.id}`, '_blank');
      return;
    }
    setCurrentBook(book);
    setView('reader');
  };

  const handleBackToLibrary = () => {
    setCurrentBook(null);
    setView('library');
  };

  if (!isInitialized) {
    return React.createElement(
      "div",
      { className: "flex items-center justify-center h-screen bg-gray-900 text-white font-sans" },
      React.createElement(
        "div",
        { className: "flex flex-col items-center gap-4" },
        React.createElement("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" }),
        React.createElement(
          "p",
          { className: "text-gray-400" },
          "Initializing Database..."
        )
      )
    );
  }

  return React.createElement(
    "div",
    { className: "min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" },
    React.createElement(Header, {
      onBack: view === 'reader' ? handleBackToLibrary : undefined,
    }),
    React.createElement(
      "main",
      { className: "flex-grow p-4 sm:p-6 md:p-8" },
      view === 'library'
        ? React.createElement(Library, {
            books: books,
            onSelectBook: handleSelectBook,
            onAddBook: addBook,
            onDeleteBook: deleteBook,
            onClearLibrary: clearBooks,
          })
        : currentBook
        ? React.createElement(Reader, { book: currentBook })
        : React.createElement(
            "div",
            { className: "flex flex-col items-center justify-center h-64" },
            React.createElement(
              "p",
              { className: "text-gray-400" },
              "No book selected."
            ),
            React.createElement(
              "button",
              { onClick: handleBackToLibrary, className: "mt-4 text-indigo-400 hover:underline" },
              "Return to Library"
            )
          )
    )
  );
};

export default App;
