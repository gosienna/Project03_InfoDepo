const LS_KEY = 'infodepo_drive_oauth_tokens';
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_EXPIRES_IN_SEC = 3600;

/**
 * Persists Google OAuth access tokens (GIS token client) keyed by clientId + scope.
 * Separate from build-time env (`VITE_CLIENT_ID`, `VITE_API_KEY`).
 */

export function getStoredAccessToken(clientId, scope) {
  if (!clientId) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.clientId !== clientId) return null;
    const entry = data.byScope?.[scope];
    if (!entry?.accessToken) return null;
    if (entry.expiresAt != null && Date.now() >= entry.expiresAt - EXPIRY_SKEW_MS) return null;
    return entry.accessToken;
  } catch {
    return null;
  }
}

export function saveStoredAccessToken(clientId, scope, accessToken, expiresInSec) {
  if (!clientId || !scope || !accessToken) return;
  let byScope = {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.clientId === clientId && parsed.byScope) byScope = { ...parsed.byScope };
    }
  } catch {
    byScope = {};
  }
  const expiresIn =
    typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : DEFAULT_EXPIRES_IN_SEC;
  const expiresAt = Date.now() + expiresIn * 1000;
  byScope[scope] = { accessToken, expiresAt };
  localStorage.setItem(LS_KEY, JSON.stringify({ clientId, byScope }));
}

export function removeStoredAccessToken(clientId, scope) {
  if (!clientId || !scope) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.clientId !== clientId || !data.byScope) return;
    const next = { ...data.byScope };
    delete next[scope];
    if (Object.keys(next).length === 0) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify({ clientId, byScope: next }));
    }
  } catch {
    /* ignore */
  }
}

export function clearAllStoredAccessTokens() {
  localStorage.removeItem(LS_KEY);
}

/** Unique tokens for the current OAuth client (e.g. revoke on sign-out). */
export function getAllStoredAccessTokens(clientId) {
  if (!clientId) return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.clientId !== clientId || !data.byScope) return [];
    const out = new Set();
    for (const ent of Object.values(data.byScope)) {
      if (ent?.accessToken) out.add(ent.accessToken);
    }
    return [...out];
  } catch {
    return [];
  }
}
