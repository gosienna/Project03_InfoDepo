/**
 * One-shot OAuth token request (Google Identity Services). Used by startup gate before Library mounts.
 */

export function waitForGoogleAccounts() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const tick = () => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Google Sign-In script did not load. Check your network and try again.'));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * @param {string} prompt GIS: '' | 'none' | 'consent' | 'select_account'
 */
export function requestDriveOauthToken(clientId, scope, { prompt = 'select_account' } = {}) {
  return new Promise((resolve, reject) => {
    if (!clientId || !scope) {
      reject(new Error('Missing OAuth client or scope'));
      return;
    }
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (res) => {
          if (res.error) {
            reject(new Error(res.error_description || res.error));
            return;
          }
          resolve({
            accessToken: res.access_token,
            expiresIn: res.expires_in,
          });
        },
      });
      client.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}
