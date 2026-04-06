import React, { useState } from 'react';
import { getDriveCredentials } from '../utils/driveCredentials.js';
import { getDriveFolderId, setDriveFolderId, parseDriveFolderIdInput } from '../utils/driveFolderStorage.js';
import { saveStoredAccessToken, getStoredAccessToken } from '../utils/driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from '../utils/driveScopes.js';
import { waitForGoogleAccounts, requestDriveOauthToken } from '../utils/driveOAuthRequest.js';
import { fetchGoogleUserEmail } from '../utils/googleUser.js';

/**
 * Full-screen setup: Drive folder ID (localStorage) + Google sign-in when needed.
 */
export const GoogleOAuthGate = ({ onSuccess, onGoogleUserEmail }) => {
  const [folderInput, setFolderInput] = useState(() => getDriveFolderId());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const runContinue = async () => {
    setError(null);
    const parsed = parseDriveFolderIdInput(folderInput);
    if (!parsed) {
      setError('Enter your Google Drive folder ID (or paste the folder URL).');
      return;
    }
    setBusy(true);
    try {
      setDriveFolderId(parsed);
      await waitForGoogleAccounts();
      const creds = getDriveCredentials();
      const scope = OWNER_DRIVE_SCOPE;
      let accessToken = getStoredAccessToken(creds.clientId, scope);
      let expiresIn;
      if (!accessToken) {
        const tok = await requestDriveOauthToken(creds.clientId, scope, {
          prompt: 'select_account',
        });
        accessToken = tok.accessToken;
        expiresIn = tok.expiresIn;
        saveStoredAccessToken(creds.clientId, scope, accessToken, expiresIn);
      }
      try {
        const email = await fetchGoogleUserEmail(accessToken);
        onGoogleUserEmail?.(email);
      } catch {
        onGoogleUserEmail?.(null);
      }
      onSuccess();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(
    'div',
    {
      className:
        'flex flex-col items-center justify-center min-h-screen bg-gray-900 text-gray-100 font-sans px-6',
    },
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
          'Choose the Drive folder for sync and backup, then sign in with Google.',
        ),
      ),
      React.createElement(
        'div',
        { className: 'text-left space-y-2' },
        React.createElement(
          'label',
          { htmlFor: 'infodepo-gate-folder', className: 'block text-sm font-medium text-gray-300' },
          'Drive folder',
        ),
        React.createElement('input', {
          id: 'infodepo-gate-folder',
          type: 'text',
          value: folderInput,
          onChange: (e) => setFolderInput(e.target.value),
          placeholder: 'Folder ID or https://drive.google.com/drive/folders/…',
          className:
            'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono',
          autoComplete: 'off',
          disabled: busy,
        }),
        React.createElement(
          'p',
          { className: 'text-xs text-gray-500' },
          'Saved in this browser only. Open the folder in Google Drive and copy the link from the address bar.',
        ),
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: busy,
          onClick: runContinue,
          className:
            'w-full px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors',
        },
        busy ? 'Working…' : 'Save folder & continue with Google',
      ),
      error &&
        React.createElement(
          'p',
          { className: 'text-sm text-red-400 text-center', role: 'alert' },
          error,
        ),
    ),
  );
};
