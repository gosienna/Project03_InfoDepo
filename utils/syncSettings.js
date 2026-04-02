const LS_KEY = 'infodepo_sync_settings';
const DEFAULT_MAX_MB = 500;

export function getSyncSettings() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return { maxStorageMB: DEFAULT_MAX_MB };
    return { maxStorageMB: DEFAULT_MAX_MB, ...JSON.parse(saved) };
  } catch {
    return { maxStorageMB: DEFAULT_MAX_MB };
  }
}

export function saveSyncSettings({ maxStorageMB }) {
  localStorage.setItem(LS_KEY, JSON.stringify({ maxStorageMB }));
}
