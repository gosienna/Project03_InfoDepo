
import React, { useMemo } from 'react';
import { getFileExtension } from '../utils/fileUtils.js';
import { EpubViewer } from './EpubViewer.js';
import { PdfViewer } from './PdfViewer.js';
import { TxtViewer } from './TxtViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

const MIME_TO_EXT = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

export const Reader = ({ book }) => {
  const fileExtension = useMemo(() => {
    const ext = getFileExtension(book.name);
    return ext || MIME_TO_EXT[book.type] || '';
  }, [book.name, book.type]);

  const renderBook = () => {
    switch (fileExtension) {
      case 'epub':
        return React.createElement(EpubViewer, { data: book.data });
      case 'pdf':
        return React.createElement(PdfViewer, { data: book.data });
      case 'txt':
        return React.createElement(TxtViewer, { data: book.data });
      default:
        return React.createElement(UnsupportedViewer, { filename: book.name });
    }
  };

  return React.createElement(
    "div",
    { className: "w-full h-[calc(100vh-140px)] flex flex-col items-center justify-center" },
    renderBook()
  );
};