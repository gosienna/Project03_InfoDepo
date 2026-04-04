
import React, { useState, useRef, useEffect } from 'react';

export const NewNoteModal = ({ onSave, onClose }) => {
  const [title, setTitle]     = useState('');
  const [content, setContent] = useState('');
  const [error, setError]     = useState(null);
  const titleRef              = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setError(null);
    const filename = trimmedTitle.endsWith('.md') ? trimmedTitle : trimmedTitle + '.md';
    const blob = new Blob([content], { type: 'text/markdown' });
    try {
      await Promise.resolve(onSave(filename, 'text/markdown', blob));
      onClose();
    } catch (err) {
      console.error('Save note failed:', err);
      setError(err?.message || 'Could not save note to library.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
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
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-gray-700' },

      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'h2',
          { className: 'text-lg font-bold text-gray-100' },
          'New Note'
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
          React.createElement(
            'label',
            { className: 'text-sm font-medium text-gray-400', htmlFor: 'note-title' },
            'Title'
          ),
          React.createElement('input', {
            id: 'note-title',
            ref: titleRef,
            type: 'text',
            value: title,
            onChange: (e) => { setTitle(e.target.value); setError(null); },
            placeholder: 'My Note',
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500',
          }),
          error && React.createElement('p', { className: 'text-xs text-red-400 mt-1' }, error)
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement(
            'label',
            { className: 'text-sm font-medium text-gray-400', htmlFor: 'note-content' },
            'Content',
            React.createElement(
              'span',
              { className: 'ml-2 text-xs text-gray-500 font-normal' },
              '(Markdown supported)'
            )
          ),
          React.createElement('textarea', {
            id: 'note-content',
            value: content,
            onChange: (e) => { setContent(e.target.value); setError(null); },
            placeholder: '# My Note\n\nStart writing here...',
            rows: 14,
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-indigo-500 placeholder-gray-500 resize-none leading-relaxed',
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
            disabled: !title.trim(),
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          'Save Note'
        )
      )
    )
  );
};
