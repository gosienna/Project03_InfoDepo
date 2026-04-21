/**
 * Owner index file: _infodepo_index.json at the root of each owner's Drive folder.
 * Receivers fetch this to discover which files are shared with them.
 */
import { fetchGoogleApisGet } from './googleApisFetch.js';

const INDEX_FILENAME = '_infodepo_index.json';

/**
 * Write (create or update) the owner's _infodepo_index.json in the linked folder.
 * Lists every item/channel that has a driveId, along with its sharedWith list.
 */
export async function writeOwnerIndex({ accessToken, folderId, ownerEmail, items, channels }) {
  const entries = [];
  for (const item of items || []) {
    const did = String(item.driveId || '').trim();
    if (!did) continue;
    entries.push({
      driveId: did,
      name: item.name,
      type: item.type,
      modifiedTime: item.modifiedTime instanceof Date ? item.modifiedTime.toISOString() : String(item.modifiedTime || ''),
      sharedWith: Array.isArray(item.sharedWith) ? item.sharedWith : [],
    });
  }
  for (const ch of channels || []) {
    const did = String(ch.driveId || '').trim();
    if (!did) continue;
    entries.push({
      driveId: did,
      name: ch.name,
      type: 'infodepo-channel',
      modifiedTime: ch.modifiedTime instanceof Date ? ch.modifiedTime.toISOString() : String(ch.modifiedTime || ''),
      sharedWith: Array.isArray(ch.sharedWith) ? ch.sharedWith : [],
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    ownerEmail: ownerEmail || '',
    items: entries,
  };

  const existingId = await findIndexFileId(accessToken, folderId);

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const form = new FormData();

  if (existingId) {
    form.append('metadata', new Blob([JSON.stringify({ mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Index PATCH failed: ${err.error?.message || res.statusText}`);
    }
  } else {
    const metadata = {
      name: INDEX_FILENAME,
      mimeType: 'application/json',
      parents: [folderId],
    };
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Index POST failed: ${err.error?.message || res.statusText}`);
    }
  }
}

/**
 * Fetch and parse _infodepo_index.json from a peer's folder.
 * Returns the parsed JSON or null on 403/404/error.
 */
export async function fetchOwnerIndex({ accessToken, folderId, expectedOwnerEmail = '' }) {
  const fileId = await findIndexFileId(accessToken, folderId);
  if (!fileId) return null;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;

  try {
    const parsed = await res.json();
    const expected = String(expectedOwnerEmail || '').trim().toLowerCase();
    const actual = String(parsed?.ownerEmail || '').trim().toLowerCase();
    if (expected && actual && expected !== actual) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function findIndexFileId(accessToken, folderId) {
  const q = encodeURIComponent(`name='${INDEX_FILENAME}' and '${folderId}' in parents and trashed=false`);
  const f = encodeURIComponent('files(id)');
  const res = await fetchGoogleApisGet(
    `/drive/v3/files?q=${q}&fields=${f}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.ok) {
    const data = await res.json();
    const direct = data.files?.[0]?.id || null;
    if (direct) return direct;
  }

  // Fallback for cases where folder-based listing is unavailable to the receiver
  // even though the index file itself is directly shared.
  const qFallback = encodeURIComponent(`name='${INDEX_FILENAME}' and sharedWithMe and trashed=false`);
  const fFallback = encodeURIComponent('files(id,modifiedTime)');
  const resFallback = await fetchGoogleApisGet(
    `/drive/v3/files?q=${qFallback}&fields=${fFallback}&orderBy=modifiedTime desc&pageSize=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resFallback.ok) return null;
  const dataFallback = await resFallback.json();
  return dataFallback.files?.[0]?.id || null;
}

/** Return the Drive file ID of the index file if it exists, or null. */
export async function getIndexFileId(accessToken, folderId) {
  return findIndexFileId(accessToken, folderId);
}
