import { getDriveCredentials } from './driveCredentials.js';
import { getDriveFolderId } from './driveFolderStorage.js';
import { getStoredAccessToken } from './driveOAuthStorage.js';
import { getLibraryMode } from './libraryMode.js';
import { getDriveScopeForLibraryMode } from './driveScopes.js';

/**
 * True when VITE_CLIENT_ID + VITE_API_KEY are set but the user still needs the setup screen:
 * missing stored Drive folder ID and/or missing non-expired OAuth token for the current library mode.
 */
export function needsDriveOAuthLogin() {
  const creds = getDriveCredentials();
  if (!creds.clientId?.trim() || !creds.apiKey?.trim()) {
    return false;
  }
  if (!getDriveFolderId().trim()) {
    return true;
  }
  const scope = getDriveScopeForLibraryMode(getLibraryMode());
  return !getStoredAccessToken(creds.clientId, scope);
}
