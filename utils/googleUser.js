/**
 * Requires OAuth scope including userinfo.email (and typically openid).
 */
export async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || res.statusText || 'Could not read Google profile');
  }
  const data = await res.json();
  if (!data.email) throw new Error('No email returned for this Google account');
  return String(data.email).trim().toLowerCase();
}
