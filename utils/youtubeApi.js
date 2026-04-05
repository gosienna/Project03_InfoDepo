
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

const HANDLE_RE = /youtube\.com\/@([a-zA-Z0-9_.-]+)/;
const CHANNEL_ID_RE = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;

function parseISO8601Duration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}

export async function resolveChannelId(urlOrHandle, apiKey) {
  const chanMatch = urlOrHandle.match(CHANNEL_ID_RE);
  if (chanMatch) {
    return { channelId: chanMatch[1], handle: '', name: '', thumbnailUrl: '' };
  }

  const handleMatch = urlOrHandle.match(HANDLE_RE);
  const handle = handleMatch ? handleMatch[1] : urlOrHandle.replace(/^@/, '');
  if (!handle) throw new Error('Could not parse channel handle from URL.');

  const res = await fetch(
    `${YT_API_BASE}/channels?forHandle=${encodeURIComponent(handle)}&part=snippet&key=${apiKey}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `YouTube API error: ${res.status}`);
  }
  const data = await res.json();
  if (!data.items?.length) throw new Error(`No channel found for handle "@${handle}".`);

  const ch = data.items[0];
  return {
    channelId: ch.id,
    handle: `@${handle}`,
    name: ch.snippet.title,
    thumbnailUrl: ch.snippet.thumbnails?.default?.url || '',
  };
}

/**
 * Fetches all non-Shorts videos for a channel.
 * Uses search.list to paginate through all uploads, then videos.list to get
 * duration + view counts, filtering out videos shorter than 60s (Shorts).
 */
export async function fetchChannelVideos(channelId, apiKey, onProgress) {
  const allVideoIds = [];
  let pageToken = '';
  let page = 0;

  // Phase 1: collect all video IDs via search.list
  do {
    const url = `${YT_API_BASE}/search?channelId=${channelId}&type=video&order=date&maxResults=50&part=id` +
      (pageToken ? `&pageToken=${pageToken}` : '') + `&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Search API error: ${res.status}`);
    }
    const data = await res.json();
    for (const item of (data.items || [])) {
      if (item.id?.videoId) allVideoIds.push(item.id.videoId);
    }
    page++;
    if (onProgress) onProgress(`Scanning videos... page ${page} (${allVideoIds.length} found)`);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  if (!allVideoIds.length) return [];

  // Phase 2: batch-fetch details (50 per request) — duration, views, snippet
  const videos = [];
  for (let i = 0; i < allVideoIds.length; i += 50) {
    const batch = allVideoIds.slice(i, i + 50);
    const url = `${YT_API_BASE}/videos?id=${batch.join(',')}&part=snippet,contentDetails,statistics&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Videos API error: ${res.status}`);
    }
    const data = await res.json();
    for (const v of (data.items || [])) {
      const durationSec = parseISO8601Duration(v.contentDetails?.duration || '');
      if (durationSec < 61) continue; // skip Shorts
      videos.push({
        videoId: v.id,
        title: v.snippet?.title || '',
        publishedAt: v.snippet?.publishedAt || '',
        thumbnailUrl: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '',
        viewCount: parseInt(v.statistics?.viewCount || '0', 10),
        duration: v.contentDetails?.duration || '',
      });
    }
    if (onProgress) onProgress(`Fetching details... ${Math.min(i + 50, allVideoIds.length)}/${allVideoIds.length}`);
  }

  return videos;
}
