/**
 * Drive reader ACL reconciliation based on per-item sharedWith fields.
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
 * Reconcile Drive ACLs from per-item `sharedWith` fields.
 * Also grants reader on the owner's _infodepo_index.json for every recipient.
 *
 * @param {object} opts
 * @param {string} opts.accessToken
 * @param {Array} opts.items - library items with { driveId, sharedWith }
 * @param {Array} opts.channels - channels with { driveId, sharedWith }
 * @param {string} [opts.indexFileId] - Drive file ID of _infodepo_index.json
 * @param {object} [opts.previousIndex] - previous index JSON (for revoke universe)
 * @param {function} [opts.onProgress]
 * @returns {{ granted: number, failed: number, revoked: number, revokeFailed: number }}
 */
export async function applySharedWithToDriveFiles({
  accessToken,
  items,
  channels,
  indexFileId,
  previousIndex,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  let granted = 0;
  let failed = 0;
  let revoked = 0;
  let revokeFailed = 0;

  const desired = new Map();
  const allRecipients = new Set();

  const addDesired = (driveId, emails) => {
    if (!driveId) return;
    if (!desired.has(driveId)) desired.set(driveId, new Set());
    for (const e of emails) {
      const norm = e.trim().toLowerCase();
      if (norm) {
        desired.get(driveId).add(norm);
        allRecipients.add(norm);
      }
    }
  };

  for (const item of items || []) {
    const did = String(item.driveId || '').trim();
    if (did && Array.isArray(item.sharedWith) && item.sharedWith.length > 0) {
      addDesired(did, item.sharedWith);
    }
  }
  for (const ch of channels || []) {
    const did = String(ch.driveId || '').trim();
    if (did && Array.isArray(ch.sharedWith) && ch.sharedWith.length > 0) {
      addDesired(did, ch.sharedWith);
    }
  }

  if (indexFileId && allRecipients.size > 0) {
    addDesired(indexFileId, allRecipients);
  }

  const recipientUniverse = new Set(allRecipients);
  if (previousIndex && Array.isArray(previousIndex.items)) {
    for (const entry of previousIndex.items) {
      if (Array.isArray(entry.sharedWith)) {
        for (const e of entry.sharedWith) {
          const norm = e.trim().toLowerCase();
          if (norm) recipientUniverse.add(norm);
        }
      }
    }
  }

  const allFileIds = new Set([...desired.keys()]);
  if (previousIndex && Array.isArray(previousIndex.items)) {
    for (const entry of previousIndex.items) {
      const did = String(entry.driveId || '').trim();
      if (did) allFileIds.add(did);
    }
  }

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
        console.warn('[Drive share] permission grant failed:', fileId, email, result.error);
      }

      await new Promise((r) => setTimeout(r, 30));
    }
  }

  progress('');
  if (failed > 0) {
    console.warn(`[Drive share] ${failed} of ${granted + failed} permission grant(s) failed.`);
  }
  return { granted, failed, revoked, revokeFailed };
}
