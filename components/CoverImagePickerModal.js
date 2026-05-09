
import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';

export const CoverImagePickerModal = ({ images, onSelect, onClose }) => {
  const [objectUrls, setObjectUrls] = useState(new Map());
  const urlsRef = useRef([]);

  useEffect(() => {
    const map = new Map();
    for (const img of images || []) {
      if (img.data instanceof Blob) {
        const url = URL.createObjectURL(img.data);
        map.set(img.id, url);
        urlsRef.current.push(url);
      }
    }
    setObjectUrls(map);
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, [images]);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const modal = React.createElement(
    'div',
    {
      className: 'fixed inset-0 flex items-center justify-center z-[120] bg-black/60',
      onClick: handleBackdrop,
    },
    React.createElement(
      'div',
      { className: 'bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-5 py-4 border-b border-gray-700' },
        React.createElement('h2', { className: 'text-white font-semibold text-base' }, 'Choose Cover from Library'),
        React.createElement(
          'button',
          { onClick: onClose, className: 'text-gray-400 hover:text-white transition-colors' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'flex-1 overflow-y-auto p-4' },
        (!images || images.length === 0)
          ? React.createElement(
              'p',
              { className: 'text-gray-400 text-sm text-center py-8' },
              'No images in library yet — import an image first.'
            )
          : React.createElement(
              'div',
              { className: 'grid grid-cols-3 gap-3' },
              images.map((img) => {
                const url = objectUrls.get(img.id);
                return React.createElement(
                  'button',
                  {
                    key: img.id,
                    onClick: () => onSelect(img),
                    className: 'group relative aspect-square rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500',
                  },
                  url
                    ? React.createElement('img', {
                        src: url,
                        alt: img.name,
                        className: 'w-full h-full object-cover',
                      })
                    : React.createElement('div', { className: 'w-full h-full bg-gray-800 flex items-center justify-center' },
                        React.createElement('span', { className: 'text-gray-500 text-xs' }, '…')
                      ),
                  React.createElement(
                    'div',
                    { className: 'absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity' },
                    img.name
                  )
                );
              })
            )
      )
    )
  );

  return ReactDOM.createPortal(modal, document.body);
};
