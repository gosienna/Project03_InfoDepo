/**
 * OAuth access token for Google Drive (GIS token client), with in-memory cache.
 * Mirrors the behavior used in `Library.js` for uploads/sync.
 */

import { getDriveCredentials } from './driveCredentials.js';
import { getStoredAccessToken, saveStoredAccessToken } from './driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from './driveScopes.js';

let cachedToken = '';
let cachedScope = '';

export function invalidateDriveAccessTokenCache() {
  cachedToken = '';
  cachedScope = '';
}

/**
 * @param {string} scope
 * @returns {Promise<string>}
 */
export function getDriveAccessTokenForScope(scope) {
  const { clientId } = getDriveCredentials();
  if (!clientId) return Promise.reject(new Error('Google Drive is not configured.'));
  if (!scope) return Promise.reject(new Error('Missing OAuth scope.'));

  if (cachedToken && cachedScope === scope) return Promise.resolve(cachedToken);

  const fromStorage = getStoredAccessToken(clientId, scope);
  if (fromStorage) {
    cachedToken = fromStorage;
    cachedScope = scope;
    return Promise.resolve(fromStorage);
  }

  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.accounts?.oauth2) {
      reject(new Error('Google Sign-In did not load.'));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (res) => {
        if (res.error) {
          reject(new Error(res.error_description || res.error));
          return;
        }
        cachedToken = res.access_token;
        cachedScope = scope;
        saveStoredAccessToken(clientId, scope, res.access_token, res.expires_in);
        resolve(res.access_token);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/** Token with permission to delete files the app created (`drive.file`). */
export function getOwnerDriveAccessToken() {
  return getDriveAccessTokenForScope(OWNER_DRIVE_SCOPE);
}
