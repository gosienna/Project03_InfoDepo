
import React, { useState, useRef, useEffect } from 'react';

export const NewUrlModal = ({ onSave, onClose }) => {
  const [url,   setUrl]   = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const handleSave = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    let normalized = trimmedUrl;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized;
    }
    try {
      new URL(normalized);
    } catch {
      setError('Please enter a valid URL.');
      return;
    }
    const trimmedTitle = title.trim() || normalized;
    const json = JSON.stringify({ url: normalized, title: trimmedTitle });
    const blob = new Blob([json], { type: 'application/x-url' });
    const filename = trimmedTitle.replace(/[/\\?%*:|"<>]/g, '-') + '.url';
    try {
      await Promise.resolve(onSave(filename, 'application/x-url', blob));
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save to library.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
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
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5 text-cyan-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' })
          ),
          React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'Add URL')
        ),
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700 transition-colors',
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
          React.createElement('label', { className: 'text-sm font-medium text-gray-400', htmlFor: 'url-input' }, 'URL'),
          React.createElement('input', {
            id: 'url-input',
            ref: urlRef,
            type: 'url',
            value: url,
            onChange: (e) => { setUrl(e.target.value); setError(null); },
            placeholder: 'https://example.com',
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 placeholder-gray-500',
          }),
          error && React.createElement('p', { className: 'text-xs text-red-400 mt-1' }, error)
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement('label', { className: 'text-sm font-medium text-gray-400', htmlFor: 'url-title' }, 'Title (optional)'),
          React.createElement('input', {
            id: 'url-title',
            type: 'text',
            value: title,
            onChange: (e) => setTitle(e.target.value),
            placeholder: 'My bookmark',
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 placeholder-gray-500',
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
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          'Save'
        )
      )
    )
  );
};
