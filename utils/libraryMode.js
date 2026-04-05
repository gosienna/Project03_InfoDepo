const LS_KEY = 'infodepo_library_mode';

/** @returns {'owner' | 'shared'} */
export function getLibraryMode() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'shared' ? 'shared' : 'owner';
  } catch {
    return 'owner';
  }
}

/** @param {'owner' | 'shared'} mode */
export function setLibraryMode(mode) {
  try {
    localStorage.setItem(LS_KEY, mode === 'shared' ? 'shared' : 'owner');
  } catch { /* ignore */ }
}
