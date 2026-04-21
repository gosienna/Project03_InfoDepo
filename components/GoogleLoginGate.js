
import React, { useState } from 'react';
import { getDriveCredentials } from '../utils/driveCredentials.js';
import { saveStoredAccessToken } from '../utils/driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from '../utils/driveScopes.js';
import { waitForGoogleAccounts, requestDriveOauthToken } from '../utils/driveOAuthRequest.js';
import { fetchGoogleUserEmail } from '../utils/googleUser.js';
import { BookIcon } from './icons/BookIcon.js';

/**
 * Step 1 of the init flow: Google sign-in only. No Drive folder input.
 * Called for all users regardless of role.
 */
export const GoogleLoginGate = ({ onSuccess }) => {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const runSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await waitForGoogleAccounts();
      const creds = getDriveCredentials();
      const tok = await requestDriveOauthToken(creds.clientId, OWNER_DRIVE_SCOPE, {
        prompt: 'select_account',
      });
      saveStoredAccessToken(creds.clientId, OWNER_DRIVE_SCOPE, tok.accessToken, tok.expiresIn);
      let email = null;
      try {
        email = await fetchGoogleUserEmail(tok.accessToken);
      } catch {
        // non-fatal: email display is optional
      }
      onSuccess(email);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(
    'div',
    { className: 'flex flex-col items-center justify-center min-h-screen bg-gray-900 text-gray-100 font-sans px-6' },
    React.createElement(
      'div',
      { className: 'max-w-sm w-full flex flex-col items-stretch gap-6' },
      React.createElement(
        'div',
        { className: 'text-center flex flex-col items-center gap-3' },
        React.createElement(BookIcon, { className: 'h-12 w-12 text-indigo-400' }),
        React.createElement('h1', { className: 'text-2xl font-semibold text-white' }, 'Personal Information Depository'),
        React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Sign in with your Google account to continue.')
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: busy,
          onClick: runSignIn,
          className: 'w-full flex items-center justify-center gap-3 px-6 py-3 rounded-lg bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 font-medium transition-colors',
        },
        !busy && React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 48 48', className: 'h-5 w-5' },
          React.createElement('path', { fill: '#FFC107', d: 'M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z' }),
          React.createElement('path', { fill: '#FF3D00', d: 'M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z' }),
          React.createElement('path', { fill: '#4CAF50', d: 'M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z' }),
          React.createElement('path', { fill: '#1976D2', d: 'M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z' })
        ),
        busy ? 'Signing in…' : 'Sign in with Google'
      ),
      error && React.createElement('p', { className: 'text-sm text-red-400 text-center', role: 'alert' }, error)
    )
  );
};
