const LS_KEY = 'infodepo_sync_settings';
const DEFAULT_MAX_GB = 500;

export function getSyncSettings() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return { maxStorageGB: DEFAULT_MAX_GB };
    const parsed = JSON.parse(saved);
    // backward-compat: migrate old maxStorageMB key
    if (parsed.maxStorageMB != null && parsed.maxStorageGB == null) {
      parsed.maxStorageGB = Math.max(1, Math.round(parsed.maxStorageMB / 1024));
    }
    return { maxStorageGB: DEFAULT_MAX_GB, ...parsed };
  } catch {
    return { maxStorageGB: DEFAULT_MAX_GB };
  }
}

export function saveSyncSettings({ maxStorageGB }) {
  localStorage.setItem(LS_KEY, JSON.stringify({ maxStorageGB }));
}
