let cachedConfig = null;

export async function fetchUserConfig(accessToken) {
  if (cachedConfig) return cachedConfig;
  const fileId = import.meta.env.VITE_CONFIG;
  if (!fileId) {
    cachedConfig = { users: {} };
    return cachedConfig;
  }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
  const text = await res.text();
  const sanitized = text.replace(/,(\s*[}\]])/g, '$1');
  let parsed;
  try {
    parsed = JSON.parse(sanitized);
  } catch (err) {
    console.error('[userConfig] JSON parse failed. Raw text was:', text);
    throw err;
  }
  cachedConfig = migrateConfig(parsed);
  return cachedConfig;
}

export function invalidateUserConfigCache() {
  cachedConfig = null;
}

/**
 * Migrate legacy { editors, viewers } to new { users } shape.
 * If already in the new shape, returns as-is.
 */
function migrateConfig(raw) {
  if (raw.users && typeof raw.users === 'object') return raw;
  const users = {};
  const masterEmail = (import.meta.env.VITE_MASTER || '').trim().toLowerCase();
  if (masterEmail) users[masterEmail] = { role: 'master' };
  for (const e of (raw.editors || [])) {
    const norm = e.trim().toLowerCase();
    if (norm && !users[norm]) users[norm] = { role: 'editor' };
  }
  for (const e of (raw.viewers || [])) {
    const norm = e.trim().toLowerCase();
    if (norm && !users[norm]) users[norm] = { role: 'viewer' };
  }
  return { master: masterEmail, users };
}

/** Returns 'master' | 'editor' | 'viewer' | null (null = not authorized) */
export function resolveUserType(email, config) {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (norm === (import.meta.env.VITE_MASTER || '').trim().toLowerCase()) return 'master';

  const cfg = migrateConfig(config);
  const entry = cfg.users?.[norm];
  if (!entry) return null;
  const role = String(entry.role || '').toLowerCase();
  if (role === 'master' || role === 'editor' || role === 'viewer') return role;
  return null;
}

/** Get the Drive folder ID stored in config for a given email. */
export function getUserFolderId(email, config) {
  if (!email || !config) return '';
  const norm = email.trim().toLowerCase();
  const cfg = migrateConfig(config);
  return String(cfg.users?.[norm]?.folderId || '').trim();
}

/** List all peer users (everyone except the given email) who have a folderId. */
export function listPeerUsers(myEmail, config) {
  if (!config) return [];
  const me = (myEmail || '').trim().toLowerCase();
  const cfg = migrateConfig(config);
  return Object.entries(cfg.users || {})
    .filter(([email, entry]) => email !== me && String(entry.folderId || '').trim())
    .map(([email, entry]) => ({
      email,
      role: entry.role,
      folderId: String(entry.folderId).trim(),
    }));
}

/** List all user emails from config (for the share picker). */
export function listAllUserEmails(config) {
  if (!config) return [];
  const cfg = migrateConfig(config);
  return Object.keys(cfg.users || {});
}
