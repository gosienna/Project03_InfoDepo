
import React, { useState, useRef, useEffect } from 'react';

const isValidYoutubeUrl = (url) =>
  /(?:youtube\.com|youtu\.be)/.test(url);

export const NewYoutubeModal = ({ onSave, onClose }) => {
  const [url,   setUrl]   = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const urlRef            = useRef(null);

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const handleSave = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (!isValidYoutubeUrl(trimmedUrl)) {
      setError('Please enter a valid YouTube URL.');
      return;
    }
    const trimmedTitle = title.trim() || 'YouTube Video';
    const json = JSON.stringify({ url: trimmedUrl, title: trimmedTitle });
    const blob = new Blob([json], { type: 'application/x-youtube' });
    if (!blob.size) {
      setError('Could not build save data.');
      return;
    }
    const filename = trimmedTitle.replace(/[/\\?%*:|"<>]/g, '-') + '.youtube';
    try {
      await Promise.resolve(onSave(filename, 'application/x-youtube', blob));
      onClose();
    } catch (err) {
      console.error('Save YouTube item failed:', err);
      setError(err?.message || 'Could not save to library.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && e.target === urlRef.current) {
      e.preventDefault();
      handleSave();
    }
  };

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
      onKeyDown: handleKeyDown,
    },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col border border-gray-700' },

      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5 text-red-500', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
          ),
          React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'Add YouTube')
        ),
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700 transition-colors',
            title: 'Close',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),

      // Body
      React.createElement(
        'div',
        { className: 'flex flex-col gap-4 p-6' },
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement('label', { className: 'text-sm font-medium text-gray-400', htmlFor: 'yt-url' }, 'YouTube URL'),
          React.createElement('input', {
            id: 'yt-url',
            ref: urlRef,
            type: 'url',
            value: url,
            onChange: (e) => { setUrl(e.target.value); setError(null); },
            placeholder: 'https://www.youtube.com/watch?v=...',
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 placeholder-gray-500',
          }),
          error && React.createElement('p', { className: 'text-xs text-red-400 mt-1' }, error)
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement('label', { className: 'text-sm font-medium text-gray-400', htmlFor: 'yt-title' }, 'Title ',
            React.createElement('span', { className: 'text-xs text-gray-500 font-normal' }, '(optional)')
          ),
          React.createElement('input', {
            id: 'yt-title',
            type: 'text',
            value: title,
            onChange: (e) => setTitle(e.target.value),
            placeholder: 'YouTube Video',
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 placeholder-gray-500',
          })
        )
      ),

      // Footer
      React.createElement(
        'div',
        { className: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700' },
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'px-5 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-gray-100 hover:bg-gray-700 transition-colors',
          },
          'Cancel'
        ),
        React.createElement(
          'button',
          {
            onClick: handleSave,
            disabled: !url.trim(),
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          'Save'
        )
      )
    )
  );
};
