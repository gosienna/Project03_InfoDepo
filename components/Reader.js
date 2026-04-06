
import React, { useMemo } from 'react';
import { getFileExtension } from '../utils/fileUtils.js';
import { EpubViewer } from './EpubViewer.js';
import { PdfViewer } from './PdfViewer.js';
import { TxtViewer } from './TxtViewer.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { YoutubeViewer } from './YoutubeViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

const MIME_TO_EXT = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/x-youtube': 'youtube',
};

export const Reader = ({ video, onUpdateItem, onAddImage, onGetImages, readOnly }) => {
  const fileExtension = useMemo(() => {
    const ext = getFileExtension(video.name);
    return ext || MIME_TO_EXT[video.type] || '';
  }, [video.name, video.type]);

  const renderContent = () => {
    switch (fileExtension) {
      case 'epub':
        return React.createElement(EpubViewer, { data: video.data });
      case 'pdf':
        return React.createElement(PdfViewer, { data: video.data });
      case 'txt':
        return React.createElement(TxtViewer, { data: video.data });
      case 'md':
        return React.createElement(MarkdownEditor, { video, onUpdateItem, onAddImage, onGetImages, readOnly });
      case 'youtube':
        return React.createElement(YoutubeViewer, { video });
      default:
        return React.createElement(UnsupportedViewer, { filename: video.name });
    }
  };

  return React.createElement(
    "div",
    { className: "w-full flex-1 min-h-0 flex flex-col items-stretch" },
    renderContent()
  );
};
