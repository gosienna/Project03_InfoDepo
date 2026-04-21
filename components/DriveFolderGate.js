
import React, { useState, useEffect } from 'react';
import { getDriveFolderId, setDriveFolderId, parseDriveFolderIdInput } from '../utils/driveFolderStorage.js';
import { getUserFolderId } from '../utils/userConfig.js';

/**
 * Step 2 of the init flow (MASTER/EDITOR only): collect the Drive folder ID.
 * If config.users has a folderId for the current user, auto-fill and continue.
 */
export const DriveFolderGate = ({ onSuccess, userEmail, config }) => {
  const [folderInput, setFolderInput] = useState(() => getDriveFolderId());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userEmail || !config) return;
    const configFolderId = getUserFolderId(userEmail, config);
    if (configFolderId) {
      setDriveFolderId(configFolderId);
      onSuccess();
    }
  }, [userEmail, config]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinue = () => {
    setError(null);
    const parsed = parseDriveFolderIdInput(folderInput);
    if (!parsed) {
      setError('Enter your Google Drive folder ID (or paste the folder URL).');
      return;
    }
    setBusy(true);
    setDriveFolderId(parsed);
    onSuccess();
  };

  return React.createElement(
    'div',
    { className: 'flex flex-col items-center justify-center min-h-screen bg-gray-900 text-gray-100 font-sans px-6' },
    React.createElement(
      'div',
      { className: 'max-w-md w-full flex flex-col items-stretch gap-5' },
      React.createElement(
        'div',
        { className: 'text-center' },
        React.createElement('h1', { className: 'text-2xl font-semibold text-white' }, 'Google Drive setup'),
        React.createElement(
          'p',
          { className: 'text-gray-400 text-sm leading-relaxed mt-2' },
          'Choose the Drive folder for sync and backup.'
        )
      ),
      React.createElement(
        'div',
        { className: 'text-left space-y-2' },
        React.createElement(
          'label',
          { htmlFor: 'infodepo-gate-folder', className: 'block text-sm font-medium text-gray-300' },
          'Drive folder'
        ),
        React.createElement('input', {
          id: 'infodepo-gate-folder',
          type: 'text',
          value: folderInput,
          onChange: (e) => setFolderInput(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') handleContinue(); },
          placeholder: 'Folder ID or https://drive.google.com/drive/folders/…',
          className: 'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono',
          autoComplete: 'off',
          disabled: busy,
          autoFocus: true,
        }),
        React.createElement(
          'p',
          { className: 'text-xs text-gray-500' },
          'Saved in this browser only. Open the folder in Google Drive and copy the link from the address bar.'
        )
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: busy || !folderInput.trim(),
          onClick: handleContinue,
          className: 'w-full px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors',
        },
        busy ? 'Working…' : 'Continue'
      ),
      error && React.createElement('p', { className: 'text-sm text-red-400 text-center', role: 'alert' }, error)
    )
  );
};
