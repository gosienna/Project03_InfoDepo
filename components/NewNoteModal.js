
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
      { className: 'bg-theme-50 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-gray-200' },

      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-200' },
        React.createElement(
          'h2',
          { className: 'text-lg font-bold text-theme-900' },
          'New Note'
        ),
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 transition-colors',
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
            { className: 'text-sm font-medium text-theme-700', htmlFor: 'note-title' },
            'Title'
          ),
          React.createElement('input', {
            id: 'note-title',
            ref: titleRef,
            type: 'text',
            value: title,
            onChange: (e) => { setTitle(e.target.value); setError(null); },
            placeholder: 'My Note',
            className: 'bg-theme-50 border border-gray-300 text-theme-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-theme-500 placeholder-theme-500',
          }),
          error && React.createElement('p', { className: 'text-xs text-red-700 mt-1' }, error)
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement(
            'label',
            { className: 'text-sm font-medium text-theme-700', htmlFor: 'note-content' },
            'Content',
            React.createElement(
              'span',
              { className: 'ml-2 text-xs text-theme-500 font-normal' },
              '(Markdown supported)'
            )
          ),
          React.createElement('textarea', {
            id: 'note-content',
            value: content,
            onChange: (e) => { setContent(e.target.value); setError(null); },
            placeholder: '# My Note\n\nStart writing here...',
            rows: 14,
            className: 'bg-theme-50 border border-gray-300 text-theme-900 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-theme-500 placeholder-theme-500 resize-none leading-relaxed',
          })
        )
      ),

      // Footer
      React.createElement(
        'div',
        { className: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200' },
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'px-5 py-2 rounded-xl text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 transition-colors',
          },
          'Cancel'
        ),
        React.createElement(
          'button',
          {
            onClick: handleSave,
            disabled: !title.trim(),
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-theme-500 hover:bg-theme-600 text-buttontext transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          'Save Note'
        )
      )
    )
  );
};
