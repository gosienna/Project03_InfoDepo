
import React from 'react';
import { getFileExtension } from '../utils/fileUtils.js';

export const UnsupportedViewer = ({ filename }) => {
  const extension = getFileExtension(filename).toUpperCase();

  return React.createElement(
    "div",
    { className: "flex flex-col items-center justify-center h-full w-full bg-theme-50 p-8 rounded-lg text-center" },
    React.createElement(
      "h2",
      { className: "text-2xl font-bold text-red-700" },
      "Unsupported File Format"
    ),
    React.createElement(
      "p",
      { className: "mt-2 text-theme-700" },
      "Sorry, we can't display ",
      React.createElement(
        "span",
        { className: "font-mono bg-gray-200 px-2 py-1 rounded" },
        extension
      ),
      " files."
    ),
    React.createElement(
      "p",
      { className: "mt-4 text-theme-500 text-sm" },
      "Supported formats: EPUB, MOBI, AZW3, PDF, TXT, and Markdown."
    )
  );
};