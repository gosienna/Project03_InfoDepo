const LS_KEY = 'infodepo_drive_credentials';

/**
 * Returns Drive credentials.
 * - Dev:  reads from Vite env vars (.env file)
 * - Prod: reads from localStorage (set via DriveSettingsModal)
 */
export function getDriveCredentials() {
  if (import.meta.env.DEV) {
    return {
      clientId: import.meta.env.VITE_TEST_CLIENT_ID        || '',
      apiKey:   import.meta.env.VITE_TEST_API_KEY          || '',
      folderId: import.meta.env.VITE_TEST_DRIVE_FOLDER_ID  || '',
    };
  }
  try {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? JSON.parse(saved) : { clientId: '', apiKey: '', folderId: '' };
  } catch {
    return { clientId: '', apiKey: '', folderId: '' };
  }
}

export function saveDriveCredentials({ clientId, apiKey, folderId }) {
  localStorage.setItem(LS_KEY, JSON.stringify({ clientId, apiKey, folderId }));
}

export function clearDriveCredentials() {
  localStorage.removeItem(LS_KEY);
}
