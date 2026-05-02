/**
 * Desk canvas layout keys: prefer Google Drive file IDs so layouts survive
 * per-device IndexedDB auto-increment ids. Legacy keys remain readable.
 *
 * Canonical formats:
 * - `drive:{driveId}` — books, notes, videos, channels, or nested desks with a Drive file
 * - `local:{idbStore}:{id}` — library items not yet on Drive (idbStore: books|notes|videos)
 * - `local:channel:{id}` — channel row not yet on Drive
 * - `desk:{id}` — nested desk without Drive backup (local IndexedDB id only)
 */

const trimDrive = (d) => String(d || '').trim();

export const itemEntryKey = (item) => {
  const d = trimDrive(item?.driveId);
  if (d) return `drive:${d}`;
  const store = item?.idbStore || 'books';
  const id = item?.id;
  if (id == null) return `local:${store}:0`;
  return `local:${store}:${id}`;
};

export const channelEntryKey = (ch) => {
  const d = trimDrive(ch?.driveId);
  if (d) return `drive:${d}`;
  const id = ch?.id;
  if (id == null) return 'local:channel:0';
  return `local:channel:${id}`;
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

/**
 * Resolve a layout key to a library record (+ _entryType) or null.
 */
export function resolveLayoutEntry(key, items, channels, desks) {
  if (!key || typeof key !== 'string') return null;

  if (key.startsWith('drive:')) {
    const driveId = trimDrive(key.slice(6));
    if (!driveId) return null;
    const item = (items || []).find((i) => trimDrive(i?.driveId) === driveId);
    if (item) return { ...item, _entryType: 'item' };
    const ch = (channels || []).find((c) => trimDrive(c?.driveId) === driveId);
    if (ch) return { ...ch, _entryType: 'channel' };
    const d = (desks || []).find((x) => trimDrive(x?.driveId) === driveId);
    return d ? { ...d, _entryType: 'desk' } : null;
  }

  const local = parseLocalKey(key);
  if (local?.kind === 'channel') {
    const ch = (channels || []).find((c) => c.id === local.id);
    return ch ? { ...ch, _entryType: 'channel' } : null;
  }
  if (local?.kind === 'item') {
    const item = (items || []).find((i) => i.idbStore === local.idbStore && i.id === local.id);
    return item ? { ...item, _entryType: 'item' } : null;
  }

  if (key.startsWith('channel:')) {
    const id = Number(key.slice(8));
    if (!Number.isFinite(id)) return null;
    const ch = (channels || []).find((c) => c.id === id);
    return ch ? { ...ch, _entryType: 'channel' } : null;
  }
  if (key.startsWith('desk:')) {
    const id = Number(key.slice(5));
    if (!Number.isFinite(id)) return null;
    const d = (desks || []).find((x) => x.id === id);
    return d ? { ...d, _entryType: 'desk' } : null;
  }

  const sep = key.lastIndexOf(':');
  if (sep <= 0) return null;
  const store = key.slice(0, sep);
  const id = Number(key.slice(sep + 1));
  if (!Number.isFinite(id)) return null;
  if (store !== 'books' && store !== 'notes' && store !== 'videos') return null;
  const item = (items || []).find((i) => i.idbStore === store && i.id === id);
  return item ? { ...item, _entryType: 'item' } : null;
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
    if (!entry) continue;
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
