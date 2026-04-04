
import React, { useState, useEffect } from 'react';
import { formatBytes, getFileExtension } from '../utils/fileUtils.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { UploadIcon } from './icons/UploadIcon.js';

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// upload status: null | 'uploading' | 'success' | 'error'
const UploadButton = ({ status, onClick }) => {
  if (status === 'uploading') {
    return React.createElement(
      "div",
      { className: "p-2 rounded-full bg-indigo-600/50 text-white", title: "Uploading..." },
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
    { onClick, title: "Upload to Google Drive", className: "p-2 rounded-full bg-indigo-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-indigo-600 transition-all duration-300" },
    React.createElement(UploadIcon, { className: "h-4 w-4" })
  );
};

export const VideoCard = ({ video, onSelect, onDelete, onUpload, uploadStatus }) => {
  const fileExtension = getFileExtension(video.name);
  const isYoutube = video.type === 'application/x-youtube';
  const [thumbVideoId, setThumbVideoId] = useState(null);

  useEffect(() => {
    if (!isYoutube || !video.data) {
      setThumbVideoId(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { url } = JSON.parse(e.target.result);
        const m = (url || '').match(YT_VIDEO_ID_RE);
        setThumbVideoId(m ? m[1] : null);
      } catch {}
    };
    reader.readAsText(video.data);
  }, [video.id, video.type, isYoutube, video.size]);

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${video.name}"?`)) {
      onDelete(video.id, video.type);
    }
  };

  const handleUpload = (e) => {
    e.stopPropagation();
    onUpload(video);
  };

  // Thumbnail area content
  const thumbnailContent = isYoutube
    ? thumbVideoId
      ? React.createElement('img', {
          src: `https://img.youtube.com/vi/${thumbVideoId}/mqdefault.jpg`,
          alt: video.name,
          className: 'w-full h-full object-cover',
        })
      : React.createElement(
          'div',
          { className: 'flex items-center justify-center w-full h-full' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-red-500/70', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
          )
        )
    : React.createElement(BookIcon, {
        className: 'h-20 w-20 text-gray-500 group-hover:text-indigo-400 transition-colors duration-300',
      });

  return React.createElement(
    "div",
    {
      className: "bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer group transition-all duration-300 transform hover:-translate-y-1 hover:shadow-indigo-500/30",
      onClick: () => onSelect(video)
    },
    React.createElement(
      "div",
      { className: "relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden" },
      thumbnailContent,
      // File type badge (top-right)
      React.createElement(
        "span",
        {
          className: isYoutube
            ? "absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded"
            : "absolute top-2 right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded"
        },
        isYoutube ? 'YouTube' : fileExtension.toUpperCase()
      ),
      // Bottom action row
      React.createElement(
        "div",
        { className: "absolute bottom-2 right-2 flex items-center gap-1.5" },
        React.createElement(UploadButton, { status: uploadStatus, onClick: handleUpload }),
        React.createElement(
          "button",
          {
            onClick: handleDelete,
            className: "p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300",
            title: "Delete"
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
        { className: "font-bold text-md text-gray-100 truncate", title: video.name },
        isYoutube ? video.name.replace(/\.youtube$/i, '') : video.name
      ),
      React.createElement(
        "p",
        { className: "text-sm text-gray-400" },
        formatBytes(video.size)
      ),
      (() => {
        const mdLike =
          video.type === "text/markdown" ||
          (typeof video.name === "string" && /\.(md|markdown|mdown|mkd)$/i.test(video.name));
        return (
          mdLike &&
          video.idbStore &&
          React.createElement(
            "p",
            {
              className: "text-[10px] text-gray-500 mt-1 font-mono",
              title:
                'Chrome: Application → Storage → IndexedDB → InfoDepo → object store "' +
                video.idbStore +
                '". Row "data" is a Blob; use the refresh icon on the DB tree if the table is stale.',
            },
            "IndexedDB table: ",
            video.idbStore
          )
        );
      })(),
    )
  );
};
