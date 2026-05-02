
import React from 'react';
import { getFileExtension } from '../utils/fileUtils.js';

export const UnsupportedViewer = ({ filename }) => {
  const extension = getFileExtension(filename).toUpperCase();

  return React.createElement(
    "div",
    { className: "flex flex-col items-center justify-center h-full w-full bg-gray-800 p-8 rounded-lg text-center" },
    React.createElement(
      "h2",
      { className: "text-2xl font-bold text-red-400" },
      "Unsupported File Format"
    ),
    React.createElement(
      "p",
      { className: "mt-2 text-gray-300" },
      "Sorry, we can't display ",
      React.createElement(
        "span",
        { className: "font-mono bg-gray-700 px-2 py-1 rounded" },
        extension
      ),
      " files."
    ),
    React.createElement(
      "p",
      { className: "mt-4 text-gray-400 text-sm" },
      "Supported formats: EPUB, MOBI, AZW3, PDF, TXT, and Markdown."
    )
  );
};