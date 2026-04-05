const LS_KEY = 'infodepo_drive_folder_id';

/**
 * User-chosen Google Drive folder for sync/backup/manifest. Persisted in localStorage.
 */

export function getDriveFolderId() {
  try {
    return localStorage.getItem(LS_KEY) || '';
  } catch {
    return '';
  }
}

export function setDriveFolderId(folderId) {
  const id = String(folderId || '').trim();
  if (!id) {
    localStorage.removeItem(LS_KEY);
    return;
  }
  localStorage.setItem(LS_KEY, id);
}

export function clearDriveFolderId() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** Accepts raw folder ID or a full Drive URL; returns trimmed folder ID or ''. */
export function parseDriveFolderIdInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const fromUrl = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  const fromOpen = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fromOpen) return fromOpen[1];
  if (/^[a-zA-Z0-9_-]+$/.test(s) && s.length >= 10) return s;
  return s;
}
