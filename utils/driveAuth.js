/**
 * Acquires a Google OAuth2 access token for the given scope.
 * Waits for the Google Identity Services script to load before requesting.
 */
export function getOAuthToken(clientId, scope) {
  return new Promise((resolve, reject) => {
    const request = () => {
      if (typeof google === 'undefined' || !google.accounts) {
        setTimeout(request, 100);
        return;
      }
      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          callback: (res) => {
            if (res.error) {
              reject(new Error(res.error_description || res.error));
              return;
            }
            resolve(res.access_token);
          },
        });
        tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        reject(err);
      }
    };
    request();
  });
}
