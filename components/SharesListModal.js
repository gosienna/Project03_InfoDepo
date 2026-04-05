
import React from 'react';

/**
 * @param {object} props
 * @param {import('../utils/sharesDriveJson.js').ShareClientRecord[]} props.shares
 * @param {() => void} props.onClose
 * @param {() => void} props.onNewShare
 * @param {() => void} props.onLinkShare
 * @param {(s: import('../utils/sharesDriveJson.js').ShareClientRecord) => void} props.onOpenShare
 * @param {(s: import('../utils/sharesDriveJson.js').ShareClientRecord) => void} [props.onDeleteShare]
 */
export const SharesListModal = ({ shares, onClose, onNewShare, onLinkShare, onOpenShare, onDeleteShare }) =>
  React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'Shares'),
        React.createElement(
          'button',
          { type: 'button', onClick: onClose, className: 'text-gray-400 hover:text-gray-200 text-xl leading-none' },
          '×'
        )
      ),
      React.createElement(
        'div',
        { className: 'p-4 flex flex-col gap-3' },
        React.createElement(
          'div',
          { className: 'flex gap-2' },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: onNewShare,
              className: 'flex-1 py-2 rounded-xl bg-teal-800 hover:bg-teal-700 text-sm font-bold text-white',
            },
            'New share'
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: onLinkShare,
              className: 'flex-1 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm font-bold text-gray-200',
            },
            'Link share…'
          )
        ),
        shares.length === 0 &&
          React.createElement('p', { className: 'text-sm text-gray-500 text-center py-4' }, 'No shares yet.'),
        shares.map((s) =>
          React.createElement(
            'div',
            {
              key: s.id,
              className: 'flex items-center justify-between gap-2 bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2',
            },
            React.createElement(
              'div',
              { className: 'min-w-0 flex-1' },
              React.createElement('div', { className: 'text-sm font-medium text-gray-200 truncate' }, s.driveFileName),
              React.createElement(
                'div',
                { className: 'text-xs text-gray-500' },
                s.role === 'receiver' ? 'Receiver' : 'Owner',
                ' · ',
                (s.recipients || []).length,
                ' recipient(s)'
              )
            ),
            React.createElement(
              'div',
              { className: 'flex items-center gap-1 shrink-0' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => onOpenShare(s),
                  className: 'px-3 py-1.5 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-xs font-bold text-white',
                },
                s.role === 'receiver' ? 'View' : 'Edit'
              ),
              onDeleteShare &&
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: (e) => {
                      e.stopPropagation();
                      if (window.confirm('Remove this share from this device?')) onDeleteShare(s);
                    },
                    className: 'px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-red-900/50 text-xs text-gray-300',
                    title: 'Remove',
                  },
                  '×'
                )
            )
          )
        )
      )
    )
  );
