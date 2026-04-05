import { normalizeTagsList } from './tagUtils.js';

export const SHARES_JSON_VERSION = 1;

/** @typedef {'owner' | 'receiver'} ShareRole */

/**
 * @typedef {object} ShareClientRecord
 * @property {string} id
 * @property {string} driveFileName
 * @property {string} driveFileId
 * @property {string[]} recipients
 * @property {string[]} includeTags
 * @property {{ name: string, driveId: string }[]} explicitRefs
 * @property {ShareRole} role
 * @property {string} updatedAt — ISO
 */

/**
 * @typedef {object} SharesDrivePayload
 * @property {number} version
 * @property {string} driveFileName
 * @property {string[]} recipients
 * @property {string[]} includeTags
 * @property {{ name: string, driveId: string }[]} explicitRefs
 * @property {string} updatedAt
 * @property {string} [localId]
 */

function normEmails(arr) {
  return [...new Set((arr || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

/** Normalize and validate explicit file picks (name + Drive file id). */
export function normalizeExplicitRefs(arr) {
  const out = [];
  for (const r of Array.isArray(arr) ? arr : []) {
    const name = String(r?.name || '').trim();
    const driveId = String(r?.driveId || '').trim();
    if (name && driveId) out.push({ name, driveId });
  }
  return out;
}

/**
 * Build JSON payload for Drive from a client record (owner).
 * @param {Omit<ShareClientRecord, 'role'> & { role?: ShareRole }} rec
 * @returns {SharesDrivePayload}
 */
export function serializeShareToDriveJson(rec) {
  const updatedAt = rec.updatedAt || new Date().toISOString();
  return {
    version: SHARES_JSON_VERSION,
    driveFileName: String(rec.driveFileName || 'share.infodepo-shares.json').trim() || 'share.infodepo-shares.json',
    recipients: normEmails(rec.recipients),
    includeTags: normalizeTagsList(rec.includeTags || []),
    explicitRefs: normalizeExplicitRefs(rec.explicitRefs),
    updatedAt,
    ...(rec.id ? { localId: rec.id } : {}),
  };
}

/**
 * @param {unknown} data
 * @returns {SharesDrivePayload | null}
 */
export function parseSharesDriveJson(data) {
  if (!data || typeof data !== 'object') return null;
  const v = data.version;
  if (v !== SHARES_JSON_VERSION) return null;
  const driveFileName = String(data.driveFileName || '').trim();
  if (!driveFileName) return null;
  const recipients = normEmails(data.recipients);
  const includeTags = normalizeTagsList(data.includeTags || []);
  const explicitRefs = normalizeExplicitRefs(data.explicitRefs);
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString();
  const localId = typeof data.localId === 'string' ? data.localId : undefined;
  return {
    version: SHARES_JSON_VERSION,
    driveFileName,
    recipients,
    includeTags,
    explicitRefs,
    updatedAt,
    ...(localId ? { localId } : {}),
  };
}

export function parseSharesDriveJsonText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return parseSharesDriveJson(data);
}

/**
 * Merge Drive payload into a client record for display (receiver or after fetch).
 * @param {string} id
 * @param {SharesDrivePayload} payload
 * @param {ShareRole} role
 * @param {string} [driveFileId]
 * @returns {ShareClientRecord}
 */
export function payloadToClientRecord(id, payload, role, driveFileId = '') {
  return {
    id,
    driveFileName: payload.driveFileName,
    driveFileId: driveFileId || '',
    recipients: payload.recipients,
    includeTags: payload.includeTags,
    explicitRefs: normalizeExplicitRefs(payload.explicitRefs),
    role,
    updatedAt: payload.updatedAt,
  };
}
