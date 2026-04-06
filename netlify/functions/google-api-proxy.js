/**
 * Server-side Google API key for Drive + YouTube discovery calls only.
 * Client sends path in `u` (encoded); key is appended here — never in the browser bundle.
 */
exports.handler = async (event) => {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GOOGLE_API_KEY is not set for this function' }),
    };
  }

  const raw = event.queryStringParameters && event.queryStringParameters.u;
  if (!raw || typeof raw !== 'string') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing query parameter u' }),
    };
  }

  let pathQuery;
  try {
    pathQuery = decodeURIComponent(raw);
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid u' }),
    };
  }

  if (!pathQuery.startsWith('/')) pathQuery = `/${pathQuery}`;
  const pathOnly = pathQuery.split('?')[0];
  const allowed =
    pathOnly.startsWith('/youtube/v3/') ||
    pathOnly.startsWith('/youtube/v3?') ||
    pathOnly === '/youtube/v3' ||
    pathOnly.startsWith('/drive/v3/') ||
    pathOnly.startsWith('/drive/v3?') ||
    pathOnly === '/drive/v3';

  if (!allowed) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Path not allowed' }),
    };
  }

  const target = new URL(`https://www.googleapis.com${pathQuery}`);
  if (target.searchParams.has('key')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Do not pass key in client request' }),
    };
  }
  target.searchParams.set('key', key);

  const headers = {};
  const auth = event.headers.authorization || event.headers.Authorization;
  if (auth) headers.Authorization = auth;

  const res = await fetch(target.toString(), { headers });
  const ct = res.headers.get('content-type') || 'application/json';
  const body = await res.text();
  return {
    statusCode: res.status,
    headers: { 'Content-Type': ct },
    body,
  };
};
