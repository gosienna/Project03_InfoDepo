/** OAuth scopes for Google Drive + profile (must stay in sync with GIS token storage keys). */

export const OWNER_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly openid https://www.googleapis.com/auth/userinfo.email';

export const SHARED_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.readonly openid https://www.googleapis.com/auth/userinfo.email';

/** @param {'owner' | 'shared'} mode */
export function getDriveScopeForLibraryMode(mode) {
  return mode === 'shared' ? SHARED_DRIVE_SCOPE : OWNER_DRIVE_SCOPE;
}
