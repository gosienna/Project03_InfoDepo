/**
 * Desk canvas layout keys: use Google Drive file IDs exclusively so layouts
 * are stable across devices. Items without a driveId have no layout key and
 * render as pending tiles on the canvas.
 *
 * Canonical formats:
 * - `drive:{driveId}` — books, notes, videos, channels, or nested desks with a Drive file
 * - `desk:{id}` — nested desk without Drive backup (local IndexedDB id only)
 *
 * Legacy `local:{idbStore}:{id}` and `local:channel:{id}` keys may still exist
 * in saved layouts; they resolve to pending tiles until a driveId is assigned.
 */

const trimDrive = (d) => String(d || '').trim();

export const itemEntryKey = (item) => {
  const d = trimDrive(item?.driveId);
  return d ? `drive:${d}` : null;
};

export const channelEntryKey = (ch) => {
  const d = trimDrive(ch?.driveId);
  return d ? `drive:${d}` : null;
};

export const deskEntryKey = (d) => {
  const id = d?.driveId != null ? trimDrive(d.driveId) : '';
  if (id) return `drive:${id}`;
  if (d?.id == null) return 'desk:0';
  return `desk:${d.id}`;
};

function parseLocalKey(key) {
  if (!key.startsWith('local:')) return null;
  const rest = key.slice(6);
  if (rest.startsWith('channel:')) {
    const id = Number(rest.slice(8));
    return Number.isFinite(id) ? { kind: 'channel', id } : null;
  }
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const store = rest.slice(0, sep);
  const id = Number(rest.slice(sep + 1));
  if (!Number.isFinite(id)) return null;
  if (store !== 'books' && store !== 'notes' && store !== 'videos') return null;
  return { kind: 'item', idbStore: store, id };
}

const PENDING = { _entryType: 'pending' };

/**
 * Resolve a layout key to a library record (+ _entryType).
 * Returns { _entryType: 'pending' } for any key that cannot be resolved to a
 * record with a stable driveId — either because the item is local-only on
 * another device or because it was deleted.
 */
export function resolveLayoutEntry(key, items, channels, desks) {
  if (!key || typeof key !== 'string') return PENDING;

  if (key.startsWith('drive:')) {
    const driveId = trimDrive(key.slice(6));
    if (!driveId) return PENDING;
    const item = (items || []).find((i) => trimDrive(i?.driveId) === driveId);
    if (item) return { ...item, _entryType: 'item' };
    const ch = (channels || []).find((c) => trimDrive(c?.driveId) === driveId);
    if (ch) return { ...ch, _entryType: 'channel' };
    const d = (desks || []).find((x) => trimDrive(x?.driveId) === driveId);
    return d ? { ...d, _entryType: 'desk' } : PENDING;
  }

  // Legacy local: keys — resolve only so migration can promote them once driveId arrives.
  // Until then they are treated as pending (no stable cross-device identity).
  const local = parseLocalKey(key);
  if (local?.kind === 'channel') {
    const ch = (channels || []).find((c) => c.id === local.id);
    return ch && ch.driveId ? { ...ch, _entryType: 'channel' } : PENDING;
  }
  if (local?.kind === 'item') {
    const item = (items || []).find((i) => i.idbStore === local.idbStore && i.id === local.id);
    return item && item.driveId ? { ...item, _entryType: 'item' } : PENDING;
  }

  if (key.startsWith('channel:')) {
    const id = Number(key.slice(8));
    if (!Number.isFinite(id)) return PENDING;
    const ch = (channels || []).find((c) => c.id === id);
    return ch && ch.driveId ? { ...ch, _entryType: 'channel' } : PENDING;
  }
  if (key.startsWith('desk:')) {
    const id = Number(key.slice(5));
    if (!Number.isFinite(id)) return PENDING;
    const d = (desks || []).find((x) => x.id === id);
    return d ? { ...d, _entryType: 'desk' } : PENDING;
  }

  // Legacy bare `{store}:{id}` keys
  const sep = key.lastIndexOf(':');
  if (sep <= 0) return PENDING;
  const store = key.slice(0, sep);
  const id = Number(key.slice(sep + 1));
  if (!Number.isFinite(id)) return PENDING;
  if (store !== 'books' && store !== 'notes' && store !== 'videos') return PENDING;
  const item = (items || []).find((i) => i.idbStore === store && i.id === id);
  return item && item.driveId ? { ...item, _entryType: 'item' } : PENDING;
}

export function canonicalKeyForEntry(entry) {
  if (!entry || !entry._entryType) return null;
  if (entry._entryType === 'item') return itemEntryKey(entry);
  if (entry._entryType === 'channel') return channelEntryKey(entry);
  if (entry._entryType === 'desk') return deskEntryKey(entry);
  return null;
}

/**
 * Remap layout + connection keys from legacy or stale forms to canonical keys.
 * @returns {{ layout: object, connections: array, changed: boolean }}
 */
export function migrateDeskDataKeys(layout, connections, items, channels, desks) {
  const srcLayout = layout && typeof layout === 'object' ? layout : {};
  const keyMap = new Map();
  for (const oldKey of Object.keys(srcLayout)) {
    const entry = resolveLayoutEntry(oldKey, items, channels, desks);
    if (!entry || entry._entryType === 'pending') continue;
    const canon = canonicalKeyForEntry(entry);
    if (canon && canon !== oldKey) keyMap.set(oldKey, canon);
  }
  if (keyMap.size === 0) return { layout: srcLayout, connections: connections || [], changed: false };

  const newLayout = {};
  for (const [k, pos] of Object.entries(srcLayout)) {
    const nk = keyMap.get(k) || k;
    newLayout[nk] = pos;
  }

  const conns = Array.isArray(connections) ? connections : [];
  const newConnections = conns.map((c) => ({
    ...c,
    fromKey: keyMap.get(c.fromKey) || c.fromKey,
    toKey: keyMap.get(c.toKey) || c.toKey,
  }));

  return { layout: newLayout, connections: newConnections, changed: true };
}

/**
 * When a record receives a Drive id, rewrite layout keys on one desk row.
 * @param {object} desk - full desk record from IndexedDB
 * @param {string[]} oldKeys - keys that should become `drive:${driveId}`
 * @param {string} driveKey - `drive:${driveId}`
 */
export function deskRecordRemapContentKeys(desk, oldKeys, driveKey) {
  if (!desk || !driveKey || oldKeys.length === 0) return null;
  const layout = desk.layout && typeof desk.layout === 'object' ? { ...desk.layout } : {};
  let touched = false;
  for (const ok of oldKeys) {
    if (ok === driveKey || !(ok in layout)) continue;
    const pos = layout[ok];
    delete layout[ok];
    layout[driveKey] = pos;
    touched = true;
  }
  if (!touched) return null;
  const connections = (desk.connections || []).map((c) => ({
    ...c,
    fromKey: oldKeys.includes(c.fromKey) ? driveKey : c.fromKey,
    toKey: oldKeys.includes(c.toKey) ? driveKey : c.toKey,
  }));
  return { ...desk, layout, connections };
}

/** Keys that may refer to a library row before it has a stable drive: key */
export function layoutKeysForLocalRecord(storeName, numericId) {
  if (numericId == null || Number.isNaN(Number(numericId))) return [];
  const id = Number(numericId);
  if (storeName === 'channels') return [`channel:${id}`, `local:channel:${id}`];
  if (storeName === 'desks') return [`desk:${id}`];
  return [`${storeName}:${id}`, `local:${storeName}:${id}`];
}
