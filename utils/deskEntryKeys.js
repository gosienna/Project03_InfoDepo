/**
 * Desk canvas layout keys: always `drive:{driveId}` where driveId is temp (local:…) or real Google file id.
 */
import { deskLayoutKey, parseDeskLayoutKey, migrationTempDriveId } from './driveRecordKey.js';

const trimDrive = (d) => String(d || '').trim();

export { deskLayoutKey, parseDeskLayoutKey };

export const itemEntryKey = (item) => deskLayoutKey(trimDrive(item?.driveId));

export const channelEntryKey = (ch) => deskLayoutKey(trimDrive(ch?.driveId));

export const deskEntryKey = (d) => deskLayoutKey(trimDrive(d?.driveId));

const PENDING = { _entryType: 'pending' };

function findByDriveId(driveId, items, channels, desks) {
  const d = trimDrive(driveId);
  if (!d) return null;
  const item = (items || []).find((i) => trimDrive(i?.driveId) === d);
  if (item) return { ...item, _entryType: 'item' };
  const ch = (channels || []).find((c) => trimDrive(c?.driveId) === d);
  if (ch) return { ...ch, _entryType: 'channel' };
  const desk = (desks || []).find((x) => trimDrive(x?.driveId) === d);
  if (desk) return { ...desk, _entryType: 'desk' };
  return null;
}

/** Legacy v9 layout keys → canonical drive:… (upgrade / one-time load only). */
function resolveLegacyLayoutKey(key, items, channels, desks) {
  if (!key || typeof key !== 'string') return PENDING;

  if (key.startsWith('local:')) {
    const rest = key.slice(6);
    if (rest.startsWith('channel:')) {
      const numId = Number(rest.slice(8));
      if (!Number.isFinite(numId)) return PENDING;
      const ch = (channels || []).find((c) => c.driveId === migrationTempDriveId('channels', numId));
      if (ch) return { ...ch, _entryType: 'channel' };
      const chLegacy = (channels || []).find((c) => {
        const legacy = migrationTempDriveId('channels', numId);
        return trimDrive(c.driveId) === legacy;
      });
      return chLegacy ? { ...chLegacy, _entryType: 'channel' } : PENDING;
    }
    const sep = rest.indexOf(':');
    if (sep <= 0) return PENDING;
    const store = rest.slice(0, sep);
    const suffix = rest.slice(sep + 1);
    if (store === 'channels') {
      const numId = Number(suffix);
      if (Number.isFinite(numId)) {
        const tempId = migrationTempDriveId('channels', numId);
        const ch = (channels || []).find((c) => trimDrive(c.driveId) === tempId);
        if (ch) return { ...ch, _entryType: 'channel' };
      }
    }
    if (store !== 'books' && store !== 'notes' && store !== 'videos') return PENDING;
    const tempId = `local:${store}:${suffix}`;
    const item = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === tempId);
    if (item) return { ...item, _entryType: 'item' };
    const numId = Number(suffix);
    if (Number.isFinite(numId)) {
      const migrated = migrationTempDriveId(store, numId);
      const item2 = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === migrated);
      if (item2) return { ...item2, _entryType: 'item' };
    }
    return PENDING;
  }

  if (key.startsWith('channel:')) {
    const numId = Number(key.slice(8));
    if (!Number.isFinite(numId)) return PENDING;
    const tempId = migrationTempDriveId('channels', numId);
    const ch = (channels || []).find((c) => trimDrive(c.driveId) === tempId);
    return ch ? { ...ch, _entryType: 'channel' } : PENDING;
  }

  if (key.startsWith('desk:')) {
    const numId = Number(key.slice(5));
    if (!Number.isFinite(numId)) return PENDING;
    const tempId = migrationTempDriveId('desks', numId);
    const d = (desks || []).find((x) => trimDrive(x.driveId) === tempId);
    return d ? { ...d, _entryType: 'desk' } : PENDING;
  }

  const sep = key.lastIndexOf(':');
  if (sep <= 0) return PENDING;
  const store = key.slice(0, sep);
  const numId = Number(key.slice(sep + 1));
  if (!Number.isFinite(numId)) return PENDING;
  if (store !== 'books' && store !== 'notes' && store !== 'videos') return PENDING;
  const tempId = migrationTempDriveId(store, numId);
  const item = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === tempId);
  return item ? { ...item, _entryType: 'item' } : PENDING;
}

/**
 * Resolve a layout key to a library record (+ _entryType).
 */
export function resolveLayoutEntry(key, items, channels, desks) {
  if (!key || typeof key !== 'string') return PENDING;

  if (key.startsWith('drive:')) {
    const parsedId = parseDeskLayoutKey(key);
    if (!parsedId) return PENDING;
    return findByDriveId(parsedId, items, channels, desks) || PENDING;
  }

  return resolveLegacyLayoutKey(key, items, channels, desks);
}

export function canonicalKeyForEntry(entry) {
  if (!entry || !entry._entryType) return null;
  if (entry._entryType === 'item') return itemEntryKey(entry);
  if (entry._entryType === 'channel') return channelEntryKey(entry);
  if (entry._entryType === 'desk') return deskEntryKey(entry);
  return null;
}

/**
 * Remap layout + connection keys to canonical drive:{driveId} (temp → real promotion on desk load).
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
 * When a record receives a real Drive id, rewrite layout keys on one desk row.
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

/** Keys that refer to a row before promote (eager remap). */
export function layoutKeysForTempRecord(_storeName, tempDriveId) {
  const d = trimDrive(tempDriveId);
  if (!d) return [];
  return [deskLayoutKey(d)];
}

/** Rewrite legacy layout keys to drive:… during v10 DB upgrade. */
export function migrateDeskLayoutKeysForV10(layout) {
  if (!layout || typeof layout !== 'object') return layout;
  const out = {};
  for (const [k, pos] of Object.entries(layout)) {
    if (k.startsWith('drive:')) {
      out[k] = pos;
      continue;
    }
    if (k.startsWith('local:')) {
      out[`drive:${k.slice(6)}`] = pos;
      continue;
    }
    if (k.startsWith('channel:')) {
      const numId = k.slice(8);
      out[`drive:local:channels:${numId}`] = pos;
      continue;
    }
    if (k.startsWith('desk:')) {
      const numId = k.slice(5);
      out[`drive:local:desks:${numId}`] = pos;
      continue;
    }
    const sep = k.lastIndexOf(':');
    if (sep > 0) {
      const store = k.slice(0, sep);
      const numId = k.slice(sep + 1);
      if (store === 'books' || store === 'notes' || store === 'videos') {
        out[`drive:local:${store}:${numId}`] = pos;
        continue;
      }
    }
    out[k] = pos;
  }
  return out;
}
