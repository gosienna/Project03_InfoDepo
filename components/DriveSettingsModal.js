import React, { useState } from 'react';
import { getDriveCredentials, saveDriveCredentials, clearDriveCredentials } from '../utils/driveCredentials.js';

export const DriveSettingsModal = ({ onSave, onClose }) => {
  const existing = getDriveCredentials();
  const [clientId, setClientId] = useState(existing.clientId);
  const [apiKey,   setApiKey]   = useState(existing.apiKey);
  const [folderId, setFolderId] = useState(existing.folderId);

  const handleSubmit = (e) => {
    e.preventDefault();
    const creds = {
      clientId: clientId.trim(),
      apiKey:   apiKey.trim(),
      folderId: folderId.trim(),
    };
    saveDriveCredentials(creds);
    onSave(creds);
  };

  const handleClear = () => {
    clearDriveCredentials();
    setClientId('');
    setApiKey('');
    setFolderId('');
  };

  const inputClass = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono';
  const labelClass = 'block text-sm font-medium text-gray-300 mb-1';

  return React.createElement(
    'div',
    { className: 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm' },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden' },

      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'div',
          null,
          React.createElement('h2', { className: 'text-lg font-bold text-white' }, 'Google Drive Settings'),
          React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, 'Credentials are saved locally in your browser.')
        ),
        React.createElement(
          'button',
          { onClick: onClose, className: 'text-gray-500 hover:text-white transition-colors' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-6 w-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),

      // Form
      React.createElement(
        'form',
        { onSubmit: handleSubmit, className: 'p-6 space-y-4' },

        React.createElement(
          'div',
          null,
          React.createElement('label', { className: labelClass }, 'OAuth Client ID'),
          React.createElement('input', {
            type: 'text',
            value: clientId,
            onChange: e => setClientId(e.target.value),
            placeholder: 'xxxxxxxxxx.apps.googleusercontent.com',
            className: inputClass,
            required: true,
            autoComplete: 'off',
          })
        ),

        React.createElement(
          'div',
          null,
          React.createElement('label', { className: labelClass }, 'API Key'),
          React.createElement('input', {
            type: 'text',
            value: apiKey,
            onChange: e => setApiKey(e.target.value),
            placeholder: 'AIza...',
            className: inputClass,
            required: true,
            autoComplete: 'off',
          })
        ),

        React.createElement(
          'div',
          null,
          React.createElement('label', { className: labelClass }, 'Drive Folder ID'),
          React.createElement('input', {
            type: 'text',
            value: folderId,
            onChange: e => setFolderId(e.target.value),
            placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
            className: inputClass,
            required: true,
            autoComplete: 'off',
          })
        ),

        // Actions
        React.createElement(
          'div',
          { className: 'flex items-center justify-between pt-2' },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: handleClear,
              className: 'text-sm text-red-400 hover:text-red-300 px-3 py-2 rounded-lg hover:bg-red-900/20 transition-colors',
            },
            'Clear credentials'
          ),
          React.createElement(
            'div',
            { className: 'flex gap-2' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: onClose,
                className: 'px-4 py-2 text-sm font-medium text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors',
              },
              'Cancel'
            ),
            React.createElement(
              'button',
              {
                type: 'submit',
                className: 'px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors',
              },
              'Save & Connect'
            )
          )
        )
      )
    )
  );
};
