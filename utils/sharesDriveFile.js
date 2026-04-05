/**
 * Upload / download InfoDepo share JSON files in the linked Drive folder (multipart, same pattern as shareManifest).
 */

import { serializeShareToDriveJson, parseSharesDriveJsonText } from './sharesDriveJson.js';

/**
 * Find a file by exact name in folder.
 * @returns {Promise<string|null>} file id
 */
export async function findSharesFileIdByName(accessToken, apiKey, folderId, fileName) {
  const safeName = String(fileName || '').replace(/'/g, "\\'");
  const q = encodeURIComponent(`'${folderId}' in parents and name = '${safeName}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const f = (data.files || [])[0];
  return f?.id || null;
}

/**
 * @param {object} opts
 * @param {string} opts.accessToken
 * @param {string} opts.apiKey
 * @param {string} opts.folderId
 * @param {import('./sharesDriveJson.js').ShareClientRecord} opts.record — owner record fields
 * @param {string} [opts.existingFileId] — prefer PATCH on this id
 */
export async function uploadSharesJsonToDrive({ accessToken, apiKey, folderId, record, existingFileId }) {
  const payload = serializeShareToDriveJson(record);
  const body = JSON.stringify(payload, null, 0);
  const blob = new Blob([body], { type: 'application/json' });
  const name = payload.driveFileName;

  let fileId = (existingFileId && String(existingFileId).trim()) || '';
  if (!fileId) {
    fileId = (await findSharesFileIdByName(accessToken, apiKey, folderId, name)) || '';
  }

  const form = new FormData();
  if (fileId) {
    form.append('metadata', new Blob([JSON.stringify({ name, mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
    return res.json();
  }

  form.append(
    'metadata',
    new Blob(
      [JSON.stringify({ name, mimeType: 'application/json', parents: folderId ? [folderId] : [] })],
      { type: 'application/json' }
    )
  );
  form.append('file', blob);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || res.statusText);
  }
  return res.json();
}

/**
 * Download share JSON by Drive file id (any file the token can read).
 */
export async function fetchSharesJsonByFileId(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return parseSharesDriveJsonText(text);
}
