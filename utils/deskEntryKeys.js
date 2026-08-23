/**
 * Desk canvas layout keys: always `drive:{driveId}` where driveId is the permanent local app key.
 * Google Drive file ids live on records as driveFileId and optionally in layout values.
 */
import { deskLayoutKey, parseDeskLayoutKey, migrationTempDriveId, isTempDriveId } from './driveRecordKey.js';

const trimDrive = (d) => String(d || '').trim();

export { deskLayoutKey, parseDeskLayoutKey };

export const itemEntryKey = (item) => deskLayoutKey(trimDrive(item?.driveId));

export const channelEntryKey = (ch) => deskLayoutKey(trimDrive(ch?.driveId));

export const deskEntryKey = (d) => deskLayoutKey(trimDrive(d?.driveId));

export function normalizeLayoutPos(pos, driveFileId) {
  const x = Number(pos?.x) || 0;
  const y = Number(pos?.y) || 0;
  const dfid = trimDrive(driveFileId) || trimDrive(pos?.driveFileId);
  const out = { x, y };
  if (dfid) out.driveFileId = dfid;
  if (pos?.displayMode === 'image') out.displayMode = 'image';
  const width = Number(pos?.width);
  if (width > 0) out.width = width;
  return out;
}

/** Unresolved layout key — upload (no Drive copy) vs sync (Drive copy, not loaded locally). */
export function pendingLayoutEntry(key, pos) {
  const driveId = key?.startsWith('drive:') ? parseDeskLayoutKey(key) : '';
  const dfid = trimDrive(pos?.driveFileId);
  let kind = 'unknown';
  if (driveId) {
    if (isTempDriveId(driveId) && !dfid) kind = 'upload';
    else if (dfid || !isTempDriveId(driveId)) kind = 'sync';
    else kind = 'upload';
  }
  return {
    _entryType: 'pending',
    _layoutKey: key || '',
    _driveId: driveId,
    _driveFileId: dfid || (!isTempDriveId(driveId) ? driveId : ''),
    _pendingKind: kind,
  };
}

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

export function findByDriveFileId(driveFileId, items, channels, desks) {
  const d = trimDrive(driveFileId);
  if (!d) return null;
  const item = (items || []).find((i) => trimDrive(i?.driveFileId) === d);
  if (item) return { ...item, _entryType: 'item' };
  const ch = (channels || []).find((c) => trimDrive(c?.driveFileId) === d);
  if (ch) return { ...ch, _entryType: 'channel' };
  const desk = (desks || []).find((x) => trimDrive(x?.driveFileId) === d);
  if (desk) return { ...desk, _entryType: 'desk' };
  return null;
}

/** Legacy v9 layout keys → canonical drive:… (upgrade / one-time load only). */
function resolveLegacyLayoutKey(key, items, channels, desks) {
  if (!key || typeof key !== 'string') return pendingLayoutEntry(key);

  if (key.startsWith('local:')) {
    const rest = key.slice(6);
    if (rest.startsWith('channel:')) {
      const numId = Number(rest.slice(8));
      if (!Number.isFinite(numId)) return pendingLayoutEntry(key);
      const ch = (channels || []).find((c) => c.driveId === migrationTempDriveId('channels', numId));
      if (ch) return { ...ch, _entryType: 'channel' };
      const chLegacy = (channels || []).find((c) => {
        const legacy = migrationTempDriveId('channels', numId);
        return trimDrive(c.driveId) === legacy;
      });
      return chLegacy ? { ...chLegacy, _entryType: 'channel' } : pendingLayoutEntry(key);
    }
    const sep = rest.indexOf(':');
    if (sep <= 0) return pendingLayoutEntry(key);
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
    if (store !== 'books' && store !== 'notes' && store !== 'videos') return pendingLayoutEntry(key);
    const tempId = `local:${store}:${suffix}`;
    const item = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === tempId);
    if (item) return { ...item, _entryType: 'item' };
    const numId = Number(suffix);
    if (Number.isFinite(numId)) {
      const migrated = migrationTempDriveId(store, numId);
      const item2 = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === migrated);
      if (item2) return { ...item2, _entryType: 'item' };
    }
    return pendingLayoutEntry(key);
  }

  if (key.startsWith('channel:')) {
    const numId = Number(key.slice(8));
    if (!Number.isFinite(numId)) return pendingLayoutEntry(key);
    const tempId = migrationTempDriveId('channels', numId);
    const ch = (channels || []).find((c) => trimDrive(c.driveId) === tempId);
    return ch ? { ...ch, _entryType: 'channel' } : pendingLayoutEntry(key);
  }

  if (key.startsWith('desk:')) {
    const numId = Number(key.slice(5));
    if (!Number.isFinite(numId)) return pendingLayoutEntry(key);
    const tempId = migrationTempDriveId('desks', numId);
    const d = (desks || []).find((x) => trimDrive(x.driveId) === tempId);
    return d ? { ...d, _entryType: 'desk' } : pendingLayoutEntry(key);
  }

  const sep = key.lastIndexOf(':');
  if (sep <= 0) return pendingLayoutEntry(key);
  const store = key.slice(0, sep);
  const numId = Number(key.slice(sep + 1));
  if (!Number.isFinite(numId)) return pendingLayoutEntry(key);
  if (store !== 'books' && store !== 'notes' && store !== 'videos') return pendingLayoutEntry(key);
  const tempId = migrationTempDriveId(store, numId);
  const item = (items || []).find((i) => i.idbStore === store && trimDrive(i.driveId) === tempId);
  return item ? { ...item, _entryType: 'item' } : pendingLayoutEntry(key);
}

/**
 * Resolve a layout key to a library record (+ _entryType).
 */
export function resolveLayoutEntry(key, items, channels, desks, pos) {
  if (!key || typeof key !== 'string') return pendingLayoutEntry(key, pos);

  if (key.startsWith('drive:')) {
    const parsedId = parseDeskLayoutKey(key);
    if (!parsedId) return pendingLayoutEntry(key, pos);
    const byLocal = findByDriveId(parsedId, items, channels, desks);
    if (byLocal) return byLocal;
    const dfid = trimDrive(pos?.driveFileId) || (!isTempDriveId(parsedId) ? parsedId : '');
    if (dfid) {
      const byFile = findByDriveFileId(dfid, items, channels, desks);
      if (byFile) return byFile;
    }
    return pendingLayoutEntry(key, pos);
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
 * Cross-device: rewrite layout keys when value.driveFileId matches a local row.
 */
export function remapDeskLayoutByDriveFileId(layout, items, channels, desks) {
  const src = layout && typeof layout === 'object' ? layout : {};
  const newLayout = { ...src };
  const keyMap = new Map();
  let changed = false;

  for (const [key, rawPos] of Object.entries(src)) {
    const pos = normalizeLayoutPos(rawPos);
    if (resolveLayoutEntry(key, items, channels, desks, pos)._entryType !== 'pending') continue;
    const dfid = trimDrive(pos.driveFileId);
    if (!dfid) continue;
    const record = findByDriveFileId(dfid, items, channels, desks);
    if (!record) continue;
    const newKey = canonicalKeyForEntry(record);
    if (!newKey || newKey === key) {
      if (!rawPos?.driveFileId && pos.driveFileId) {
        newLayout[key] = pos;
        changed = true;
      }
      continue;
    }
    keyMap.set(key, newKey);
    if (newKey in newLayout) {
      const prev = newLayout[newKey];
      if (!prev?.driveFileId && pos.driveFileId) newLayout[newKey] = pos;
    } else {
      newLayout[newKey] = pos;
    }
    delete newLayout[key];
    changed = true;
  }

  return { layout: newLayout, keyMap, changed };
}

/**
 * Normalize desk layout + connections to v11: local driveId keys, optional driveFileId in values.
 * Idempotent — safe on DB upgrade and every desk open.
 */
export function normalizeDeskLayoutV11(layout, connections, items, channels, desks) {
  const srcLayout = layout && typeof layout === 'object' ? layout : {};
  const keyMap = new Map();
  const newLayout = {};
  let changed = false;

  for (const [oldKey, rawPos] of Object.entries(srcLayout)) {
    let canonicalKey = oldKey;
    let driveFileId = trimDrive(rawPos?.driveFileId);

    if (oldKey.startsWith('drive:')) {
      const suffix = parseDeskLayoutKey(oldKey);
      if (isTempDriveId(suffix)) {
        canonicalKey = deskLayoutKey(suffix);
        const record = findByDriveId(suffix, items, channels, desks);
        if (record && !driveFileId) driveFileId = trimDrive(record.driveFileId);
      } else {
        driveFileId = driveFileId || suffix;
        const record = findByDriveFileId(driveFileId, items, channels, desks)
          || findByDriveId(suffix, items, channels, desks);
        if (record) {
          canonicalKey = deskLayoutKey(record.driveId);
          if (!trimDrive(record.driveFileId)) driveFileId = suffix;
        }
      }
    } else {
      const entry = resolveLegacyLayoutKey(oldKey, items, channels, desks);
      if (entry._entryType !== 'pending') {
        const canon = canonicalKeyForEntry(entry);
        if (canon) canonicalKey = canon;
        if (!driveFileId) driveFileId = trimDrive(entry.driveFileId);
      }
    }

    const normPos = normalizeLayoutPos(rawPos, driveFileId);
    const posChanged = normPos.x !== rawPos?.x || normPos.y !== rawPos?.y
      || trimDrive(rawPos?.driveFileId) !== (normPos.driveFileId || '');
    if (canonicalKey !== oldKey || posChanged) changed = true;
    if (canonicalKey !== oldKey) keyMap.set(oldKey, canonicalKey);

    if (canonicalKey in newLayout) {
      const prev = newLayout[canonicalKey];
      if (!prev?.driveFileId && normPos.driveFileId) {
        newLayout[canonicalKey] = normPos;
        changed = true;
      }
    } else {
      newLayout[canonicalKey] = normPos;
    }
  }

  const cross = remapDeskLayoutByDriveFileId(newLayout, items, channels, desks);
  if (cross.changed) {
    changed = true;
    for (const [ok, nk] of cross.keyMap) keyMap.set(ok, nk);
  }

  const finalLayout = cross.layout;
  const conns = Array.isArray(connections) ? connections : [];
  const applyKey = (k) => {
    if (keyMap.has(k)) return keyMap.get(k);
    for (const [ok, nk] of keyMap) {
      if (k === ok) return nk;
    }
    return k;
  };
  const newConnections = conns.map((c) => {
    const fromKey = applyKey(c.fromKey);
    const toKey = applyKey(c.toKey);
    if (fromKey !== c.fromKey || toKey !== c.toKey) changed = true;
    return { ...c, fromKey, toKey };
  });

  return { layout: finalLayout, connections: newConnections, changed };
}

/** @deprecated Use normalizeDeskLayoutV11 */
export function migrateDeskDataKeys(layout, connections, items, channels, desks) {
  return normalizeDeskLayoutV11(layout, connections, items, channels, desks);
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
