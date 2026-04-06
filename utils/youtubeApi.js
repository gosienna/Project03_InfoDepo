
import { fetchGoogleApisGet } from './googleApisFetch.js';

const HANDLE_RE = /youtube\.com\/@([a-zA-Z0-9_.-]+)/;
const CHANNEL_ID_RE = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;

function parseISO8601Duration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}

export async function resolveChannelId(urlOrHandle) {
  const chanMatch = urlOrHandle.match(CHANNEL_ID_RE);
  if (chanMatch) {
    return { channelId: chanMatch[1], handle: '', name: '', thumbnailUrl: '' };
  }

  const handleMatch = urlOrHandle.match(HANDLE_RE);
  const handle = handleMatch ? handleMatch[1] : urlOrHandle.replace(/^@/, '');
  if (!handle) throw new Error('Could not parse channel handle from URL.');

  const res = await fetchGoogleApisGet(
    `/youtube/v3/channels?forHandle=${encodeURIComponent(handle)}&part=snippet`
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
 * Fetches video IDs from a channel's uploads playlist (complete list). Falls back to
 * search.list only if the uploads playlist is unavailable — search is incomplete for many channels.
 */
async function collectVideoIdsFromUploadsPlaylist(channelId, onProgress) {
  const chPath = `/youtube/v3/channels?id=${encodeURIComponent(channelId)}&part=contentDetails`;
  const chRes = await fetchGoogleApisGet(chPath);
  if (!chRes.ok) {
    const err = await chRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Channels API error: ${chRes.status}`);
  }
  const chData = await chRes.json();
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return null;

  const allVideoIds = [];
  let pageToken = '';
  let page = 0;
  do {
    const path =
      `/youtube/v3/playlistItems?playlistId=${encodeURIComponent(uploadsId)}&maxResults=50&part=contentDetails` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchGoogleApisGet(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `PlaylistItems API error: ${res.status}`);
    }
    const data = await res.json();
    for (const item of (data.items || [])) {
      const vid = item.contentDetails?.videoId;
      if (vid) allVideoIds.push(vid);
    }
    page++;
    if (onProgress) onProgress(`Scanning uploads... page ${page} (${allVideoIds.length} found)`);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return allVideoIds;
}

/** search.list — can miss most uploads; only used as fallback. */
async function collectVideoIdsFromSearch(channelId, onProgress) {
  const allVideoIds = [];
  let pageToken = '';
  let page = 0;
  do {
    const path =
      `/youtube/v3/search?channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=50&part=id` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchGoogleApisGet(path);
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
  return allVideoIds;
}

/**
 * Fetches all non-Shorts videos for a channel.
 * Uses the uploads playlist + playlistItems (full catalog), then videos.list for
 * duration + view counts, filtering out videos shorter than 60s (Shorts).
 */
export async function fetchChannelVideos(channelId, onProgress) {
  let allVideoIds = await collectVideoIdsFromUploadsPlaylist(channelId, onProgress);
  if (allVideoIds === null) {
    if (onProgress) onProgress('Falling back to search (may be incomplete)...');
    allVideoIds = await collectVideoIdsFromSearch(channelId, onProgress);
  }

  if (!allVideoIds.length) return [];

  const videos = [];
  for (let i = 0; i < allVideoIds.length; i += 50) {
    const batch = allVideoIds.slice(i, i + 50);
    const path = `/youtube/v3/videos?id=${batch.join(',')}&part=snippet,contentDetails,statistics`;
    const res = await fetchGoogleApisGet(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Videos API error: ${res.status}`);
    }
    const data = await res.json();
    for (const v of (data.items || [])) {
      const durationSec = parseISO8601Duration(v.contentDetails?.duration || '');
      if (durationSec < 61) continue;
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
