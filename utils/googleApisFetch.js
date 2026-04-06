/**
 * GET requests to www.googleapis.com that require an API key query param.
 * - Default: append VITE_API_KEY (local dev).
 * - When VITE_GOOGLE_API_PROXY is true: GET /.netlify/functions/google-api-proxy (key only on server).
 */

const USE_PROXY =
  import.meta.env.VITE_GOOGLE_API_PROXY === 'true' ||
  import.meta.env.VITE_GOOGLE_API_PROXY === '1';

/**
 * @param {string} pathAndQuery - Path starting with /youtube/v3 or /drive/v3, including query (no key=).
 * @param {RequestInit} [init]
 */
export async function fetchGoogleApisGet(pathAndQuery, init = {}) {
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  if (!USE_PROXY) {
    const apiKey = import.meta.env.VITE_API_KEY || '';
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://www.googleapis.com${path}${sep}key=${encodeURIComponent(apiKey)}`;
    return fetch(url, init);
  }
  const u = encodeURIComponent(path);
  return fetch(`/.netlify/functions/google-api-proxy?u=${u}`, init);
}

export function isGoogleApiProxyEnabled() {
  return USE_PROXY;
}
