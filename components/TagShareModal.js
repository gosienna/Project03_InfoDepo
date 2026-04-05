
import React, { useState, useEffect, useMemo } from 'react';

const labelClass = 'block text-xs font-semibold text-gray-400 mb-1';

/**
 * @param {object} props
 * @param {string[]} props.availableTags — tags used in the library (+ existing share rows), sorted
 */
export const TagShareModal = ({ onClose, getTagSharesList, setTagShareEmails, deleteTagShare, availableTags }) => {
  const [rows, setRows] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [newEmails, setNewEmails] = useState('');
  const [error, setError] = useState(null);

  const load = () => {
    getTagSharesList()
      .then((list) => setRows(list.map((r) => ({ tag: r.tag, emails: (r.emails || []).join(', ') }))))
      .catch(() => setRows([]));
  };

  // Reload when modal opens and whenever library tags change (e.g. DataTile edits prune `tagShares`)
  useEffect(() => { load(); }, [availableTags]);

  const tagsAlreadyConfigured = useMemo(() => new Set(rows.map((r) => r.tag)), [rows]);

  /** Tags you can add recipient emails for (in library but not yet in the list below, or all library tags for clarity) */
  const tagsToPickForNewShare = useMemo(() => {
    const list = availableTags || [];
    return list.filter((t) => t && !tagsAlreadyConfigured.has(t));
  }, [availableTags, tagsAlreadyConfigured]);

  const parseEmails = (s) =>
    String(s || '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  const handleSaveRow = async (tag, emailsStr) => {
    setError(null);
    try {
      await setTagShareEmails(tag, parseEmails(emailsStr));
      load();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const handleAdd = async () => {
    setError(null);
    if (!selectedTag) {
      setError('Choose a tag from your library.');
      return;
    }
    try {
      await setTagShareEmails(selectedTag, parseEmails(newEmails));
      setSelectedTag('');
      setNewEmails('');
      load();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const handleRemove = async (tag) => {
    if (!window.confirm(`Remove share settings for tag "${tag}"?`)) return;
    setError(null);
    try {
      await deleteTagShare(tag);
      load();
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm',
      onClick: onClose,
    },
    React.createElement(
      'div',
      {
        className: 'bg-gray-800 border border-gray-600 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6',
        onClick: (e) => e.stopPropagation(),
      },
      React.createElement('h2', { className: 'text-xl font-bold text-gray-100 mb-1' }, 'Tag sharing'),
      React.createElement(
        'p',
        { className: 'text-sm text-gray-400 mb-3' },
        'Tag items, then assign Gmail addresses per tag. On ',
        React.createElement('strong', { className: 'text-gray-300' }, 'Sync'),
        ', the app grants those accounts ',
        React.createElement('strong', { className: 'text-gray-300' }, 'View'),
        ' access on each matching file in Google Drive (via the Drive sharing API), uploads ',
        React.createElement('code', { className: 'text-teal-300' }, 'InfoDepo.share.json'),
        ', and recipients can use Sync shared. Optionally share the folder as Viewer in Drive if you rely on folder access.'
      ),
      (availableTags || []).length > 0 &&
        React.createElement(
          'div',
          { className: 'mb-4 p-3 rounded-xl bg-gray-900/80 border border-gray-700/80' },
          React.createElement('p', { className: 'text-xs font-semibold text-gray-400 mb-1.5' }, 'Tags in your library'),
          React.createElement(
            'p',
            { className: 'text-sm text-gray-200 font-mono break-words leading-relaxed' },
            (availableTags || []).join(', ')
          )
        ),
      error && React.createElement(
        'div',
        { className: 'mb-3 text-sm text-red-300 bg-red-900/30 border border-red-800/50 rounded-lg px-3 py-2' },
        error
      ),
      React.createElement(
        'div',
        { className: 'space-y-4 mb-6' },
        rows.map((row) =>
          React.createElement(
            'div',
            { key: row.tag, className: 'border border-gray-700 rounded-xl p-3' },
            React.createElement('label', { className: labelClass }, 'Tag'),
            React.createElement('div', { className: 'text-gray-200 font-mono text-sm mb-2' }, row.tag),
            React.createElement('label', { className: labelClass }, 'Recipient emails (comma-separated)'),
            React.createElement('textarea', {
              className: 'w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 mb-2',
              rows: 2,
              defaultValue: row.emails,
              id: `emails-${row.tag}`,
            }),
            React.createElement(
              'div',
              { className: 'flex gap-2' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-sm font-semibold',
                  onClick: () => {
                    const el = document.getElementById(`emails-${row.tag}`);
                    handleSaveRow(row.tag, el ? el.value : row.emails);
                  },
                },
                'Save'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm',
                  onClick: () => handleRemove(row.tag),
                },
                'Remove'
              )
            )
          )
        )
      ),
      React.createElement('h3', { className: 'text-sm font-bold text-gray-300 mb-2' }, 'Share a tag'),
      React.createElement('label', { className: labelClass, htmlFor: 'tag-share-pick' }, 'Tag'),
      tagsToPickForNewShare.length === 0
        ? React.createElement(
            'p',
            { className: 'text-sm text-amber-200/90 bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2 mb-2' },
            (availableTags || []).length === 0
              ? 'Add tags to your library items first (on each card), then return here.'
              : 'Every tag in your library already has share settings below — edit emails there or remove a row to add again.'
          )
        : React.createElement(
            'select',
            {
              id: 'tag-share-pick',
              value: selectedTag,
              onChange: (e) => setSelectedTag(e.target.value),
              className:
                'w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 mb-2 font-mono cursor-pointer',
            },
            React.createElement('option', { value: '' }, 'Choose tag…'),
            tagsToPickForNewShare.map((t) => React.createElement('option', { key: t, value: t }, t))
          ),
      React.createElement('label', { className: labelClass }, 'Recipient emails'),
      React.createElement('textarea', {
        value: newEmails,
        onChange: (e) => setNewEmails(e.target.value),
        placeholder: 'friend@gmail.com',
        rows: 2,
        className: 'w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 mb-3',
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: handleAdd,
          disabled: tagsToPickForNewShare.length === 0,
          className:
            'w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm mb-4',
        },
        'Save recipients for tag'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onClose,
          className: 'w-full py-2 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-700 text-sm',
        },
        'Close'
      )
    )
  );
};
