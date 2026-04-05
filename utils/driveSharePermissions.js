/**
 * Drive reader ACL reconciliation: tag-share rows and/or owner share records from the `shares` IndexedDB store.
 */
import {
  buildFileToDesiredReaders,
  collectRecipientEmailsUnion,
  collectAllDriveFileIdsForReconcile,
  buildFileToDesiredReadersFromShareRecords,
  collectRecipientEmailsFromShares,
  collectAllDriveFileIdsForShareReconcile,
} from './shareManifest.js';

/**
 * Grant a Google account view (reader) access to a single Drive file.
 * Uses Permissions API; requires OAuth scope that allows permission creation (e.g. drive.file for app-created files).
 *
 * @see https://developers.google.com/drive/api/reference/rest/v3/permissions/create
 */
async function ensureReaderForUser(accessToken, fileId, emailAddress) {
  const email = String(emailAddress).trim().toLowerCase();
  if (!email || !fileId) return { ok: false, error: 'missing email or fileId' };

  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions` +
    '?sendNotificationEmail=false&fields=id';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'user',
      role: 'reader',
      emailAddress: email,
    }),
  });

  if (res.ok) return { ok: true };

  const err = await res.json().catch(() => ({}));
  const msg = err.error?.message || res.statusText || '';

  if (res.status === 400 && /already|duplicate/i.test(msg)) {
    return { ok: true, skipped: true };
  }

  return { ok: false, error: msg || String(res.status) };
}

async function listReaderUserPermissions(accessToken, fileId) {
  const collected = [];
  let pageToken = '';
  for (;;) {
    const q = new URLSearchParams({
      fields: 'nextPageToken,permissions(id,type,emailAddress,role)',
      pageSize: '100',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${q}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { ok: false, permissions: [] };
    const data = await res.json();
    for (const p of data.permissions || []) {
      if (p.type === 'user' && p.emailAddress && p.role === 'reader') {
        collected.push(p);
      }
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return { ok: true, permissions: collected };
}

async function deletePermission(accessToken, fileId, permissionId) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok || res.status === 404) return { ok: true };
  const err = await res.json().catch(() => ({}));
  return { ok: false, error: err.error?.message || res.statusText };
}

/**
 * Reconcile Drive ACLs with current tags + Tag sharing: revoke reader access for recipients who no
 * longer apply (tag removed from item, email removed from tag share, etc.), then grant missing readers.
 * `previousManifest` should be the manifest on Drive **before** this sync uploads a new one, so
 * recipients removed from config are still in the "universe" for revocation.
 *
 * @param {object|null} [previousManifest] — parsed v1 manifest from before upload (or null)
 * @returns {{ granted: number, failed: number, revoked: number, revokeFailed: number }}
 */
export async function applyTagSharesToDriveFiles({
  accessToken,
  items,
  images,
  channels,
  tagSharesRows,
  previousManifest = null,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  let granted = 0;
  let failed = 0;
  let revoked = 0;
  let revokeFailed = 0;

  const rows = tagSharesRows || [];
  const desired = await buildFileToDesiredReaders(rows, items, images, channels || []);
  const recipientUniverse = collectRecipientEmailsUnion(rows, previousManifest);
  const allFileIds = collectAllDriveFileIdsForReconcile(items, images, channels, previousManifest);

  for (const fileId of allFileIds) {
    const desiredForFile = desired.get(fileId) || new Set();

    progress(`Drive access (revoke check): ${fileId.slice(0, 12)}…`);

    const { ok, permissions } = await listReaderUserPermissions(accessToken, fileId);
    if (!ok) {
      revokeFailed++;
      await new Promise((r) => setTimeout(r, 30));
      continue;
    }

    for (const p of permissions) {
      const email = String(p.emailAddress || '').trim().toLowerCase();
      if (!email || !p.id) continue;
      if (!recipientUniverse.has(email)) continue;
      if (desiredForFile.has(email)) continue;

      progress(`Drive revoke: ${email} ← ${fileId.slice(0, 12)}…`);
      const del = await deletePermission(accessToken, fileId, p.id);
      if (del.ok) revoked++;
      else {
        revokeFailed++;
        console.warn('[Drive share revoke]', fileId, email, del.error);
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    await new Promise((r) => setTimeout(r, 20));
  }

  for (const [fileId, emailSet] of desired.entries()) {
    for (const email of emailSet) {
      progress(`Drive access: ${email} ← ${fileId.slice(0, 12)}…`);

      const result = await ensureReaderForUser(accessToken, fileId, email);
      if (result.ok) granted++;
      else {
        failed++;
        console.warn('[Drive share]', fileId, email, result.error);
      }

      await new Promise((r) => setTimeout(r, 30));
    }
  }

  progress('');
  return { granted, failed, revoked, revokeFailed };
}

/**
 * Reconcile Drive ACLs from owner `shares` records (IndexedDB). Receiver rows ignored.
 * @param {object} opts
 * @param {Array<import('./sharesDriveJson.js').ShareClientRecord>} opts.shareRecords
 * @param {Array<import('./sharesDriveJson.js').SharesDrivePayload|null>} [opts.previousSharePayloads] — parsed JSON from Drive before overwrite (per owner share), same order as helpful for debugging only; union used for revoke universe
 */
export async function applyShareRecordsToDriveFiles({
  accessToken,
  items,
  images,
  channels,
  shareRecords,
  previousSharePayloads = [],
  onProgress,
}) {
  const progress = onProgress || (() => {});
  let granted = 0;
  let failed = 0;
  let revoked = 0;
  let revokeFailed = 0;

  const owners = (shareRecords || []).filter((r) => r && r.role !== 'receiver');
  const desired = await buildFileToDesiredReadersFromShareRecords(owners, items, images, channels || []);
  const recipientUniverse = collectRecipientEmailsFromShares(owners, previousSharePayloads);
  const allFileIds = await collectAllDriveFileIdsForShareReconcile(
    items,
    images,
    channels,
    previousSharePayloads,
    owners
  );

  for (const fileId of allFileIds) {
    const desiredForFile = desired.get(fileId) || new Set();

    progress(`Drive access (revoke check): ${fileId.slice(0, 12)}…`);

    const { ok, permissions } = await listReaderUserPermissions(accessToken, fileId);
    if (!ok) {
      revokeFailed++;
      await new Promise((r) => setTimeout(r, 30));
      continue;
    }

    for (const p of permissions) {
      const email = String(p.emailAddress || '').trim().toLowerCase();
      if (!email || !p.id) continue;
      if (!recipientUniverse.has(email)) continue;
      if (desiredForFile.has(email)) continue;

      progress(`Drive revoke: ${email} ← ${fileId.slice(0, 12)}…`);
      const del = await deletePermission(accessToken, fileId, p.id);
      if (del.ok) revoked++;
      else {
        revokeFailed++;
        console.warn('[Drive share revoke]', fileId, email, del.error);
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    await new Promise((r) => setTimeout(r, 20));
  }

  for (const [fileId, emailSet] of desired.entries()) {
    for (const email of emailSet) {
      progress(`Drive access: ${email} ← ${fileId.slice(0, 12)}…`);

      const result = await ensureReaderForUser(accessToken, fileId, email);
      if (result.ok) granted++;
      else {
        failed++;
        console.warn('[Drive share]', fileId, email, result.error);
      }

      await new Promise((r) => setTimeout(r, 30));
    }
  }

  progress('');
  return { granted, failed, revoked, revokeFailed };
}
