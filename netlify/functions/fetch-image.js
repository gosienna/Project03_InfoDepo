/**
 * Image proxy — fetches a remote image and returns it as base64 JSON.
 * Used by the Explorer component to download images for local IndexedDB storage.
 */
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  let url;
  try {
    url = params.u ? decodeURIComponent(params.u) : null;
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid u parameter' }),
    };
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing or invalid URL' }),
    };
  }

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InfoDepo/1.0)',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Fetch failed: ${e.message}` }),
    };
  }

  if (!res.ok) {
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Target returned ${res.status}` }),
    };
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';

  // Sanity-check: only proxy image content types
  if (!contentType.startsWith('image/')) {
    return {
      statusCode: 415,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Not an image: ${contentType}` }),
    };
  }

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  // Derive a clean filename from the URL path
  const rawFilename = url.split('/').pop().split('?')[0].split('#')[0];
  const filename = rawFilename && /\.\w{2,5}$/.test(rawFilename) ? rawFilename : `image_${Date.now()}.jpg`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, contentType, filename }),
  };
};
