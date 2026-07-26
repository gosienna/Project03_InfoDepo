
import React from 'react';
import { formatBytes, getFileExtension } from '../utils/fileUtils.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { UploadIcon } from './icons/UploadIcon.js';

// upload status: null | 'uploading' | 'success' | 'error'
const UploadButton = ({ status, onClick }) => {
  if (status === 'uploading') {
    return React.createElement(
      "div",
      { className: "p-2 rounded-full bg-theme-600/50 text-white", title: "Uploading..." },
      React.createElement("div", { className: "h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" })
    );
  }
  if (status === 'success') {
    return React.createElement(
      "div",
      { className: "p-2 rounded-full bg-green-600/70 text-white", title: "Uploaded to Drive" },
      React.createElement(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", className: "h-4 w-4", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
        React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M5 13l4 4L19 7" })
      )
    );
  }
  if (status === 'error') {
    return React.createElement(
      "button",
      { onClick, title: "Upload failed — click to retry", className: "p-2 rounded-full bg-red-600/70 text-white hover:bg-red-600 transition-colors" },
      React.createElement(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", className: "h-4 w-4", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
        React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" })
      )
    );
  }
  return React.createElement(
    "button",
    { onClick, title: "Upload to Google Drive", className: "p-2 rounded-full bg-theme-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-theme-600 transition-all duration-300" },
    React.createElement(UploadIcon, { className: "h-4 w-4" })
  );
};

export const BookCard = ({ book, onSelect, onDelete, onUpload, uploadStatus }) => {
  const fileExtension = getFileExtension(book.name);
  const isCloudOnly = book.isMetadataOnly === true;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${book.name}"?`)) {
      onDelete(book.id);
    }
  };

  const handleUpload = (e) => {
    e.stopPropagation();
    onUpload(book);
  };

  return React.createElement(
    "div",
    {
      className: isCloudOnly
        ? "bg-theme-100 rounded-lg shadow-lg overflow-hidden cursor-pointer group transition-all duration-300 transform hover:-translate-y-1 border-2 border-dashed border-gray-300"
        : "bg-theme-50 rounded-lg shadow-lg overflow-hidden cursor-pointer group transition-all duration-300 transform hover:-translate-y-1 hover:shadow-theme-500/30",
      onClick: () => onSelect(book)
    },
    React.createElement(
      "div",
      { className: "relative p-4 bg-gray-100 h-40 flex items-center justify-center" },
      React.createElement(BookIcon, {
        className: isCloudOnly
          ? "h-20 w-20 text-gray-400"
          : "h-20 w-20 text-gray-400 group-hover:text-theme-600 transition-colors duration-300"
      }),
      // File type badge (top-right)
      React.createElement(
        "span",
        { className: "absolute top-2 right-2 bg-theme-600 text-white text-xs font-bold px-2 py-1 rounded" },
        fileExtension.toUpperCase()
      ),
      // Cloud-only badge (top-left)
      isCloudOnly && React.createElement(
        "span",
        { className: "absolute top-2 left-2 flex items-center gap-1 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded border border-blue-200" },
        "☁ Cloud"
      ),
      // Bottom action row
      React.createElement(
        "div",
        { className: "absolute bottom-2 right-2 flex items-center gap-1.5" },
        !isCloudOnly && React.createElement(UploadButton, { status: uploadStatus, onClick: handleUpload }),
        React.createElement(
          "button",
          {
            onClick: handleDelete,
            className: "p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300",
            title: "Delete Book"
          },
          React.createElement(TrashIcon, { className: "h-4 w-4" })
        )
      )
    ),
    React.createElement(
      "div",
      { className: "p-4" },
      React.createElement(
        "h3",
        { className: "font-bold text-md text-theme-900 truncate", title: book.name },
        book.name
      ),
      React.createElement(
        "p",
        { className: "text-sm text-theme-700" },
        formatBytes(book.size)
      ),
      isCloudOnly && React.createElement(
        "p",
        { className: "text-xs text-blue-700 mt-1" },
        "Click to download & read"
      )
    )
  );
};
