/**
 * OAuth client + API key from Vite env (`.env` locally, Netlify UI in production).
 * Same variable names everywhere; no dev/prod branching.
 *
 * Drive folder ID is user-provided and stored in localStorage — see `driveFolderStorage.js`.
 */

export function getDriveCredentials() {
  return {
    clientId: import.meta.env.VITE_CLIENT_ID || '',
    apiKey: import.meta.env.VITE_API_KEY || '',
  };
}
