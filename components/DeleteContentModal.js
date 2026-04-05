import React, { useState } from 'react';

/**
 * Choose whether to remove only from IndexedDB or also delete backed-up file(s) on Google Drive.
 */
export const DeleteContentModal = ({
  title,
  name,
  hasDriveCopy,
  canDeleteFromDrive,
  onRemoveLocal,
  onRemoveFromDrive,
  onClose,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      await Promise.resolve(fn());
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const showDrive = hasDriveCopy && canDeleteFromDrive;

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4',
      onClick: (e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      },
    },
    React.createElement(
      'div',
      {
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'delete-content-modal-title',
        className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col border border-gray-700',
      },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'h2',
          { id: 'delete-content-modal-title', className: 'text-lg font-bold text-gray-100' },
          title || 'Remove from library'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => { if (!busy) onClose(); },
            disabled: busy,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50',
            title: 'Close',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'px-6 py-4 flex flex-col gap-4' },
        React.createElement(
          'p',
          { className: 'text-sm text-gray-300' },
          React.createElement('span', { className: 'font-medium text-gray-100' }, name || 'This item'),
          hasDriveCopy
            ? ' is stored on this device. It also has a copy on Google Drive from backup or sync.'
            : ' will be removed from this device only.'
        ),
        hasDriveCopy &&
          !canDeleteFromDrive &&
          React.createElement(
            'p',
            { className: 'text-xs text-amber-400/90' },
            'Google Drive sign-in is not available, so only local removal is possible. The file on Drive will stay until you delete it in Drive.'
          ),
        error &&
          React.createElement(
            'p',
            { className: 'text-sm text-red-400' },
            error
          ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-2' },
          showDrive &&
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => run(onRemoveFromDrive),
                className:
                  'w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50',
              },
              busy ? 'Removing…' : 'Remove from this device and delete on Google Drive'
            ),
          React.createElement(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => run(onRemoveLocal),
              className: showDrive
                ? 'w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-100 transition-colors disabled:opacity-50'
                : 'w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50',
            },
            busy && !showDrive
              ? 'Removing…'
              : showDrive
                ? 'Remove from this device only (keep on Google Drive)'
                : hasDriveCopy
                  ? 'Remove from this device only (keep on Google Drive)'
                  : 'Remove from this device'
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: onClose,
              className: 'w-full py-2 px-4 rounded-xl text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50',
            },
            'Cancel'
          )
        )
      )
    )
  );
};
