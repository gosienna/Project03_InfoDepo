import { getDriveCredentials } from './driveCredentials.js';
import { getStoredAccessToken, saveStoredAccessToken } from './driveOAuthStorage.js';

let uploadTokenCache = null;
let lastScope = '';

export function peekDriveImplicitUploadToken() {
  return uploadTokenCache;
}

export function resetDriveImplicitUploadToken() {
  uploadTokenCache = null;
  lastScope = '';
}

/**
 * OAuth implicit-flow token for Drive uploads (same cache as legacy Library upload bar).
 */
export function getDriveTokenForScope(scope) {
  const credentials = getDriveCredentials();
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.accounts) {
      reject(new Error('Google API not loaded'));
      return;
    }
    if (lastScope !== scope) {
      uploadTokenCache = null;
      lastScope = scope;
    }
    if (!uploadTokenCache) {
      const fromStorage = getStoredAccessToken(credentials.clientId, scope);
      if (fromStorage) uploadTokenCache = fromStorage;
    }
    if (uploadTokenCache) {
      resolve(uploadTokenCache);
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: credentials.clientId,
      scope,
      callback: (res) => {
        if (res.error) {
          reject(new Error(res.error_description || res.error));
          return;
        }
        uploadTokenCache = res.access_token;
        saveStoredAccessToken(
          credentials.clientId,
          scope,
          res.access_token,
          res.expires_in,
        );
        resolve(uploadTokenCache);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}
