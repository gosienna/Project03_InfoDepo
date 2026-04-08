export const LIBRARY_DISPLAY_POLICIES = {
  modifiedTimeBased: 'modifiedTimeBased',
  random: 'random',
};

export const LIBRARY_DISPLAY_POLICY_STORAGE_KEY = 'infodepo_library_display_policy';

export function modifiedTimeSortMs(rec) {
  const t = rec?.localModifiedAt ?? rec?.modifiedTime ?? rec?.updatedAt;
  if (t instanceof Date && !Number.isNaN(t.getTime())) return t.getTime();
  if (typeof t === 'string' || typeof t === 'number') {
    const ms = new Date(t).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

function shuffleRows(rows) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function applyLibraryDisplayPolicy(rows, policy) {
  if (policy === LIBRARY_DISPLAY_POLICIES.modifiedTimeBased) {
    return [...rows].sort((a, b) => (b.sortMs || 0) - (a.sortMs || 0));
  }
  return shuffleRows(rows);
}

export function readLibraryDisplayPolicy() {
  try {
    const raw = localStorage.getItem(LIBRARY_DISPLAY_POLICY_STORAGE_KEY);
    if (raw === LIBRARY_DISPLAY_POLICIES.modifiedTimeBased || raw === LIBRARY_DISPLAY_POLICIES.random) {
      return raw;
    }
  } catch {}
  return LIBRARY_DISPLAY_POLICIES.random;
}

export function writeLibraryDisplayPolicy(policy) {
  try {
    localStorage.setItem(LIBRARY_DISPLAY_POLICY_STORAGE_KEY, policy);
  } catch {}
}
