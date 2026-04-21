/** OAuth scopes for Google Drive + profile (must stay in sync with GIS token storage keys). */

export const OWNER_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly openid https://www.googleapis.com/auth/userinfo.email';

// Needed for editing existing config.json not created by this app.
export const CONFIG_MANAGE_SCOPE =
  'https://www.googleapis.com/auth/drive openid https://www.googleapis.com/auth/userinfo.email';
