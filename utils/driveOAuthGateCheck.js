import { getDriveCredentials, hasGoogleApiKeyOrProxy } from './driveCredentials.js';
import { getDriveFolderId } from './driveFolderStorage.js';
import { getStoredAccessToken } from './driveOAuthStorage.js';
import { OWNER_DRIVE_SCOPE } from './driveScopes.js';

/**
 * True when VITE_CLIENT_ID + API access are configured but no valid OAuth token exists.
 * Does NOT check for Drive folder ID — that is a separate step for MASTER/EDITOR only.
 */
export function needsGoogleSignIn() {
  const creds = getDriveCredentials();
  if (!creds.clientId?.trim() || !hasGoogleApiKeyOrProxy(creds)) return false;
  return !getStoredAccessToken(creds.clientId, OWNER_DRIVE_SCOPE);
}

/**
 * @deprecated Use needsGoogleSignIn() + separate DriveFolderGate for MASTER/EDITOR.
 * Kept for any legacy callers.
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
