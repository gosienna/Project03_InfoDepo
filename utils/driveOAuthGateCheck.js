import { getDriveCredentials, hasGoogleApiKeyOrProxy } from './driveCredentials.js';
import { getDriveFolderId } from './driveFolderStorage.js';
import { getStoredAccessToken } from './driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from './driveScopes.js';

/**
 * True when VITE_CLIENT_ID + API access (VITE_API_KEY or proxy) are set but the user still needs the setup screen:
 * missing stored Drive folder ID and/or missing non-expired OAuth token.
 */
export function needsDriveOAuthLogin() {
  const creds = getDriveCredentials();
  if (!creds.clientId?.trim() || !hasGoogleApiKeyOrProxy(creds)) {
    return false;
  }
  if (!getDriveFolderId().trim()) {
    return true;
  }
  return !getStoredAccessToken(creds.clientId, OWNER_DRIVE_SCOPE);
}
