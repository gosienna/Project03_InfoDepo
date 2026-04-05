import { normalizeTag, normalizeTagsList } from './tagUtils.js';

export const SHARE_MANIFEST_NAME = 'InfoDepo.share.json';

const NOTES_STORE = 'notes';

async function blobToText(blob) {
  if (!blob) return '';
  if (typeof blob === 'string') return blob;
  return blob.text();
}

/**
 * Collect Drive file IDs for a tag: tagged items with driveId, images referenced by tagged notes,
 * tagged images, and tagged YouTube channel JSON files (`channels` store).
 */
export async function collectDriveIdsForTag(tag, items, images, channels) {
  const t = normalizeTag(tag);
  if (!t) return [];
  const ids = new Set();
  const itemsArr = items || [];
  const imagesArr = images || [];
  const channelsArr = channels || [];

  for (const item of itemsArr) {
    const tags = normalizeTagsList(item.tags || []);
    if (!tags.includes(t)) continue;
    if (item.driveId) ids.add(item.driveId);

    if (item.idbStore === NOTES_STORE && item.type === 'text/markdown' && item.driveId) {
      const text = await blobToText(item.data);
      const imgRefs = text.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
      for (const ref of imgRefs) {
        const m = ref.match(/!\[[^\]]*\]\(([^)]+)\)/);
        if (!m) continue;
        const fname = m[1];
        const img = imagesArr.find((im) => im.noteId === item.id && im.name === fname);
        if (img?.driveId) ids.add(img.driveId);
      }
    }
  }

  for (const img of imagesArr) {
    const tags = normalizeTagsList(img.tags || []);
    if (tags.includes(t) && img.driveId) ids.add(img.driveId);
  }

  for (const ch of channelsArr) {
    const tags = normalizeTagsList(ch.tags || []);
    if (tags.includes(t) && ch.driveId) ids.add(ch.driveId);
  }

  return [...ids];
}

/**
 * Drive IDs for explicitly listed refs: each driveId plus embedded images for markdown notes.
 */
export async function collectDriveIdsForExplicitRefs(explicitRefs, items, images, channels) {
  const ids = new Set();
  const itemsArr = items || [];
  const imagesArr = images || [];
  const refs = explicitRefs || [];

  for (const ref of refs) {
    const did = String(ref?.driveId || '').trim();
    if (!did) continue;
    ids.add(did);
    const item = itemsArr.find((it) => it.driveId === did);
    if (item && item.idbStore === NOTES_STORE && item.type === 'text/markdown' && item.data) {
      const text = await blobToText(item.data);
      const imgRefs = text.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
      for (const r of imgRefs) {
        const m = r.match(/!\[[^\]]*\]\(([^)]+)\)/);
        if (!m) continue;
        const fname = m[1];
        const img = imagesArr.find((im) => im.noteId === item.id && im.name === fname);
        if (img?.driveId) ids.add(img.driveId);
      }
    }
    const ch = (channels || []).find((c) => c.driveId === did);
    if (ch) ids.add(did);
  }

  return [...ids];
}

/**
 * @param {Array<{
 *   recipients: string[],
 *   includeTags: string[],
 *   explicitRefs: { name: string, driveId: string }[],
 *   role?: string
 * }>} shareRecords — owner rows only
 */
export async function buildFileToDesiredReadersFromShareRecords(shareRecords, items, images, channels) {
  const map = new Map();
  const rows = (shareRecords || []).filter((r) => r && r.role !== 'receiver');

  for (const rec of rows) {
    const emails = [
      ...new Set(
        (rec.recipients || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      ),
    ];
    if (emails.length === 0) continue;

    const idSet = new Set();
    for (const tag of rec.includeTags || []) {
      const tids = await collectDriveIdsForTag(tag, items, images, channels || []);
      tids.forEach((id) => idSet.add(id));
    }
    const eids = await collectDriveIdsForExplicitRefs(rec.explicitRefs, items, images, channels || []);
    eids.forEach((id) => idSet.add(id));

    for (const fid of idSet) {
      if (!map.has(fid)) map.set(fid, new Set());
      const set = map.get(fid);
      for (const e of emails) set.add(e);
    }
  }

  return map;
}

/**
 * Union of recipient emails from owner share records and optional previous Drive payloads.
 */
export function collectRecipientEmailsFromShares(shareRecords, previousPayloads) {
  const s = new Set();
  for (const rec of shareRecords || []) {
    if (rec?.role === 'receiver') continue;
    for (const e of rec.recipients || []) {
      const n = String(e).trim().toLowerCase();
      if (n) s.add(n);
    }
  }
  for (const p of previousPayloads || []) {
    for (const e of p?.recipients || []) {
      const n = String(e).trim().toLowerCase();
      if (n) s.add(n);
    }
  }
  return s;
}

/**
 * Expand a saved share JSON payload to all Drive file IDs it implies (tags + explicit + note images).
 */
export async function expandSharePayloadToDriveIds(payload, items, images, channels) {
  const ids = new Set();
  if (!payload) return ids;
  for (const tag of payload.includeTags || []) {
    (await collectDriveIdsForTag(tag, items, images, channels || [])).forEach((id) => ids.add(id));
  }
  (await collectDriveIdsForExplicitRefs(payload.explicitRefs, items, images, channels || [])).forEach((id) =>
    ids.add(id)
  );
  return ids;
}

/**
 * All Drive file IDs to reconcile for share ACLs: library + current owner config + previous payloads.
 * @param {Array<object>} [currentOwnerRecords] — owner rows with includeTags / explicitRefs
 */
export async function collectAllDriveFileIdsForShareReconcile(
  items,
  images,
  channels,
  previousPayloads,
  currentOwnerRecords
) {
  const ids = new Set();
  for (const it of items || []) {
    if (it.driveId) ids.add(it.driveId);
  }
  for (const im of images || []) {
    if (im.driveId) ids.add(im.driveId);
  }
  for (const ch of channels || []) {
    if (ch.driveId) ids.add(ch.driveId);
  }
  for (const rec of currentOwnerRecords || []) {
    if (!rec || rec.role === 'receiver') continue;
    const expanded = await expandSharePayloadToDriveIds(
      { includeTags: rec.includeTags, explicitRefs: rec.explicitRefs },
      items,
      images,
      channels || []
    );
    expanded.forEach((id) => ids.add(id));
  }
  for (const p of previousPayloads || []) {
    const expanded = await expandSharePayloadToDriveIds(p, items, images, channels || []);
    expanded.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * @param {object} opts
 * @param {Array} opts.items — merged library rows (books, notes, videos)
 * @param {Array} opts.images
 * @param {Array} [opts.channels] — YouTube channel rows (driveId + tags when backed up)
 * @param {Array<{ tag: string, emails: string[] }>} opts.tagSharesRows
 */
export async function buildShareManifest({ items, images, channels, tagSharesRows }) {
  const tagsOut = {};
  const rows = tagSharesRows || [];
  const chList = channels || [];

  for (const row of rows) {
    const tagKey = normalizeTag(row.tag);
    if (!tagKey) continue;
    const emails = [...new Set((row.emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const driveFileIds = await collectDriveIdsForTag(tagKey, items, images, chList);
    tagsOut[tagKey] = { emails, driveFileIds };
  }

  return { version: 1, tags: tagsOut };
}

/**
 * Map each Drive file ID → Set of emails that should have reader access from current tags + tag shares.
 * Same inclusion rules as {@link collectDriveIdsForTag} per tag row.
 */
export async function buildFileToDesiredReaders(tagSharesRows, items, images, channels) {
  const map = new Map();
  const rows = tagSharesRows || [];

  for (const row of rows) {
    const tagKey = normalizeTag(row.tag);
    if (!tagKey) continue;
    const emails = [
      ...new Set(
        (row.emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      ),
    ];
    if (emails.length === 0) continue;

    const driveIds = await collectDriveIdsForTag(tagKey, items, images, channels || []);
    for (const fid of driveIds) {
      if (!map.has(fid)) map.set(fid, new Set());
      const set = map.get(fid);
      for (const e of emails) set.add(e);
    }
  }

  return map;
}

/** Union of recipient emails from tag-share rows and from a v1 manifest (for revoke after config changes). */
export function collectRecipientEmailsUnion(tagSharesRows, manifest) {
  const s = new Set();
  for (const row of tagSharesRows || []) {
    for (const e of row.emails || []) {
      const n = String(e).trim().toLowerCase();
      if (n) s.add(n);
    }
  }
  if (manifest?.tags) {
    for (const entry of Object.values(manifest.tags)) {
      const list = entry?.emails;
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const n = String(e).trim().toLowerCase();
        if (n) s.add(n);
      }
    }
  }
  return s;
}

/**
 * All Drive file IDs to reconcile permissions for: current library + any IDs from a previous manifest
 * (covers files no longer in local DB but still on Drive with stale ACLs).
 */
export function collectAllDriveFileIdsForReconcile(items, images, channels, manifest) {
  const ids = new Set();
  for (const it of items || []) {
    if (it.driveId) ids.add(it.driveId);
  }
  for (const im of images || []) {
    if (im.driveId) ids.add(im.driveId);
  }
  for (const ch of channels || []) {
    if (ch.driveId) ids.add(ch.driveId);
  }
  if (manifest?.tags) {
    for (const entry of Object.values(manifest.tags)) {
      const files = entry?.driveFileIds;
      if (!Array.isArray(files)) continue;
      for (const id of files) {
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

export function parseShareManifestJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || typeof data.tags !== 'object' || data.tags === null) return null;
  return data;
}

/** Union of drive file IDs for an email across all tags in the manifest. */
export function getDriveIdsForRecipientEmail(manifest, email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || !manifest?.tags) return new Set();
  const ids = new Set();
  for (const entry of Object.values(manifest.tags)) {
    const list = entry?.emails;
    if (!Array.isArray(list) || !list.map((x) => String(x).trim().toLowerCase()).includes(em)) continue;
    const files = entry?.driveFileIds;
    if (Array.isArray(files)) files.forEach((id) => { if (id) ids.add(id); });
  }
  return ids;
}

async function findManifestFileId(accessToken, apiKey, folderId) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and name = '${SHARE_MANIFEST_NAME}' and trashed = false`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const f = (data.files || [])[0];
  return f?.id || null;
}

/**
 * Create or replace InfoDepo.share.json in the folder.
 */
export async function uploadShareManifest({ accessToken, apiKey, folderId, manifest }) {
  const body = JSON.stringify(manifest, null, 0);
  const blob = new Blob([body], { type: 'application/json' });
  const existingId = await findManifestFileId(accessToken, apiKey, folderId);

  const uploadBlob = async (metadata, fileBlob) => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileBlob);
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
    const res = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
    return res.json();
  };

  if (existingId) {
    await uploadBlob({ name: SHARE_MANIFEST_NAME, mimeType: 'application/json' }, blob);
  } else {
    await uploadBlob(
      {
        name: SHARE_MANIFEST_NAME,
        mimeType: 'application/json',
        parents: folderId ? [folderId] : [],
      },
      blob
    );
  }
}

/**
 * Download and parse the share manifest from Drive, or null if missing / invalid.
 */
export async function fetchShareManifest({ accessToken, apiKey, folderId }) {
  const fileId = await findManifestFileId(accessToken, apiKey, folderId);
  if (!fileId) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const text = await res.text();
  return parseShareManifestJson(text);
}
