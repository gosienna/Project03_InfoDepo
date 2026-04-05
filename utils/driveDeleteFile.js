/**
 * Permanently deletes a file in the authenticated user's Google Drive (Drive API v3).
 * @param {string} accessToken
 * @param {string} fileId
 */
export async function deleteDriveFile(accessToken, fileId) {
  const id = String(fileId || '').trim();
  if (!id || !accessToken) return;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.ok || res.status === 404) return;
  const text = await res.text().catch(() => '');
  throw new Error(`Could not delete file on Google Drive (${res.status}). ${text.slice(0, 240)}`);
}
