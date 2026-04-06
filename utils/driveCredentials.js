/**
 * OAuth client from Vite env. API key: either VITE_API_KEY (local dev) or server-only via
 * Netlify function when VITE_GOOGLE_API_PROXY is true (see `googleApisFetch.js`).
 *
 * Drive folder ID is user-provided and stored in localStorage — see `driveFolderStorage.js`.
 */

export function getDriveCredentials() {
  const useGoogleApiProxy =
    import.meta.env.VITE_GOOGLE_API_PROXY === 'true' ||
    import.meta.env.VITE_GOOGLE_API_PROXY === '1';
  return {
    clientId: import.meta.env.VITE_CLIENT_ID || '',
    apiKey: useGoogleApiProxy ? '' : (import.meta.env.VITE_API_KEY || ''),
    useGoogleApiProxy,
  };
}

/** True when YouTube/Drive discovery calls can run (browser key or Netlify proxy). */
export function hasGoogleApiKeyOrProxy(creds) {
  const c = creds || getDriveCredentials();
  return Boolean((c.apiKey && String(c.apiKey).trim()) || c.useGoogleApiProxy);
}
