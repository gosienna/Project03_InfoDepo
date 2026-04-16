
import React, { useState, useEffect } from 'react';
import { fetchVideoChannelInfo, fetchNewChannelVideos, fetchChannelVideos } from '../utils/youtubeApi.js';
import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from '../utils/infodepoDb.js';
import { DataTile } from './DataTile.js';
import { hasGoogleApiKeyOrProxy } from '../utils/driveCredentials.js';
import { fetchGoogleApisGet } from '../utils/googleApisFetch.js';

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoId(url) {
  const m = (url || '').match(YT_VIDEO_ID_RE);
  return m ? m[1] : null;
}

// Lightweight direct IDB lookup — avoids importing the full useIndexedDB hook.
async function getChannelFromDB(channelId) {
  return new Promise((resolve) => {
    const req = indexedDB.open(INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('channels', 'readonly');
      const getReq = tx.objectStore('channels').index('channelId').get(channelId);
      getReq.onsuccess = (ev) => { resolve(ev.target.result ?? null); db.close(); };
      getReq.onerror  = ()   => { resolve(null); db.close(); };
    };
    req.onerror = () => resolve(null);
  });
}

// Same shape as videoToLibraryItem in YoutubeChannelViewer.js
function videoToItem(v) {
  const json = JSON.stringify({ url: `https://www.youtube.com/watch?v=${v.videoId}`, title: v.title });
  const blob = new Blob([json], { type: 'application/x-youtube' });
  return {
    id: v.videoId,
    name: v.title + '.youtube',
    type: 'application/x-youtube',
    data: blob,
    size: blob.size,
    idbStore: 'videos',
    _channelVideo: v,
  };
}

export const YoutubeViewer = ({ video, onSelectChannel, onAddChannel }) => {
  const [parsed,          setParsed]          = useState(null);
  const [isLoading,       setIsLoading]       = useState(true);
  const [error,           setError]           = useState(null);
  const [currentVideoId,  setCurrentVideoId]  = useState(null);
  const [channelVideos,   setChannelVideos]   = useState([]);
  const [channelTitle,    setChannelTitle]    = useState('');
  const [ytChannelId,     setYtChannelId]     = useState(null);
  const [cachedChannel,   setCachedChannel]   = useState(null);  // IndexedDB record or null
  const [recsState,       setRecsState]       = useState('idle'); // 'idle'|'loading'|'loaded'|'error'|'no-key'
  const [recsPage,        setRecsPage]        = useState(0);
  const [addChState,      setAddChState]      = useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [addChProgress,   setAddChProgress]   = useState('');

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setParsed(null);
    if (!video?.data) {
      setError('No saved URL/title data for this entry.');
      setIsLoading(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        setParsed(JSON.parse(e.target.result));
      } catch {
        setError('Invalid YouTube file format.');
      }
      setIsLoading(false);
    };
    reader.onerror = () => { setError('Failed to read file.'); setIsLoading(false); };
    reader.readAsText(video.data);
  }, [video.id, video.type, video.size]);

  const url     = parsed?.url || '';
  const title   = parsed?.title || 'YouTube Video';
  const videoId = extractVideoId(url);

  // Sync currentVideoId when the parsed video changes.
  useEffect(() => {
    if (videoId) setCurrentVideoId(videoId);
  }, [videoId]);

  // Fetch recommendations for the channel of the current video.
  useEffect(() => {
    if (!videoId) return;
    setYtChannelId(null);
    setCachedChannel(null);
    setAddChState('idle');
    setAddChProgress('');
    if (!hasGoogleApiKeyOrProxy()) { setRecsState('no-key'); return; }
    let cancelled = false;
    setRecsState('loading');
    setChannelVideos([]);
    setChannelTitle('');
    setRecsPage(0);

    (async () => {
      try {
        const info = await fetchVideoChannelInfo(videoId);
        if (cancelled || !info) { if (!cancelled) setRecsState('error'); return; }

        setChannelTitle(info.channelTitle);
        setYtChannelId(info.channelId);

        // Prefer cached channel from IndexedDB
        const cached = await getChannelFromDB(info.channelId);
        if (cancelled) return;
        setCachedChannel(cached || null);

        let videos;
        if (cached && Array.isArray(cached.videos) && cached.videos.length) {
          videos = cached.videos;
        } else {
          // Fetch first page of uploads (~50 most recent, Shorts excluded)
          videos = await fetchNewChannelVideos({ channelId: info.channelId, videos: [] });
        }
        if (cancelled) return;

        // Exclude the currently-playing video
        const recs = videos.filter((v) => v.videoId !== videoId);
        setChannelVideos(recs);
        setRecsState('loaded');
      } catch {
        if (!cancelled) setRecsState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [videoId]);

  const handleAddChannel = async () => {
    if (!ytChannelId || !onAddChannel || addChState === 'loading') return;
    setAddChState('loading');
    setAddChProgress('Fetching channel info…');
    try {
      // Get channel snippet for handle + thumbnail
      const res = await fetchGoogleApisGet(
        `/youtube/v3/channels?id=${encodeURIComponent(ytChannelId)}&part=snippet`
      );
      const data = res.ok ? await res.json() : { items: [] };
      const ch = data.items?.[0];
      const name = ch?.snippet?.title || channelTitle || 'Unknown Channel';
      const handle = ch?.snippet?.customUrl ? `@${ch.snippet.customUrl.replace(/^@/, '')}` : '';
      const thumbnailUrl = ch?.snippet?.thumbnails?.default?.url || '';

      setAddChProgress('Fetching videos…');
      const videos = await fetchChannelVideos(ytChannelId, (msg) => setAddChProgress(msg));

      await onAddChannel({ channelId: ytChannelId, handle, name, thumbnailUrl, videos, tags: [] });

      // Re-fetch from DB to get the auto-incremented id for navigation
      const stored = await getChannelFromDB(ytChannelId);
      setCachedChannel(stored || null);
      setAddChState('done');
      setAddChProgress('');
    } catch (err) {
      console.error('[YoutubeViewer] Add channel failed:', err);
      setAddChState('error');
      setAddChProgress('');
    }
  };

  if (isLoading) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center w-full h-full' },
      React.createElement('div', { className: 'animate-spin rounded-full h-8 w-8 border-b-2 border-red-500' })
    );
  }

  if (error) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center w-full h-full' },
      React.createElement(
        'div',
        { className: 'bg-gray-800 rounded-xl p-6 text-center max-w-sm' },
        React.createElement('p', { className: 'text-red-400 font-medium' }, error)
      )
    );
  }

  // Channel button — shown once we know whether the channel is in IndexedDB
  const channelButton = (() => {
    if (!ytChannelId || recsState === 'idle' || recsState === 'loading') return null;

    if (cachedChannel && onSelectChannel) {
      return React.createElement(
        'button',
        {
          onClick: () => onSelectChannel(cachedChannel),
          title: `Go to channel: ${cachedChannel.name || channelTitle}`,
          className: 'flex items-center gap-1.5 bg-gray-800/90 hover:bg-gray-700 text-gray-200 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors border border-gray-700',
        },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M15 19l-7-7 7-7' })
        ),
        'Channel'
      );
    }

    if (!cachedChannel && onAddChannel) {
      if (addChState === 'loading') {
        return React.createElement(
          'div',
          { className: 'flex items-center gap-2 bg-gray-800/90 text-gray-300 text-sm px-3 py-1.5 rounded-lg border border-gray-700' },
          React.createElement('div', { className: 'h-3.5 w-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin' }),
          React.createElement('span', { className: 'max-w-[180px] truncate' }, addChProgress || 'Adding…')
        );
      }
      if (addChState === 'error') {
        return React.createElement(
          'button',
          {
            onClick: handleAddChannel,
            title: 'Failed — click to retry',
            className: 'flex items-center gap-1.5 bg-red-800/80 hover:bg-red-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors border border-red-700',
          },
          'Retry add channel'
        );
      }
      return React.createElement(
        'button',
        {
          onClick: handleAddChannel,
          title: `Add "${channelTitle}" to your library`,
          className: 'flex items-center gap-1.5 bg-gray-800/90 hover:bg-gray-700 text-gray-200 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors border border-gray-700',
        },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
        ),
        'Add channel'
      );
    }

    return null;
  })();

  return React.createElement(
    'div',
    { className: 'relative w-full h-full flex flex-col items-center bg-gray-900 p-6 overflow-y-auto' },

    // Channel button — upper left corner
    channelButton && React.createElement(
      'div',
      { className: 'absolute top-4 left-4 z-10' },
      channelButton
    ),

    // Title
    React.createElement(
      'h1',
      { className: 'text-xl font-bold text-gray-100 mb-4 text-center max-w-2xl w-full' },
      title
    ),

    // Content area
    React.createElement(
      'div',
      { className: 'w-full' },

      videoId
        // Embedded player
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { style: { position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '12px', overflow: 'hidden' } },
              React.createElement('iframe', {
                src: `https://www.youtube-nocookie.com/embed/${currentVideoId ?? videoId}?rel=0`,
                title,
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
                allowFullScreen: true,
                style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' },
              })
            ),

            // Button row
            React.createElement(
              'div',
              { className: 'flex justify-center items-center gap-3 mt-4' },
              React.createElement(
                'a',
                {
                  href: url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  className: 'flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-xl transition-colors',
                },
                React.createElement(
                  'svg',
                  { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'currentColor', viewBox: '0 0 24 24' },
                  React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
                ),
                'Open in YouTube'
              )
            ),

            // Recommendations: loading state
            recsState === 'loading' && React.createElement(
              'div',
              { className: 'mt-8 text-center text-gray-400 text-sm' },
              'Loading recommendations…'
            ),

            // Recommendations: loaded state
            recsState === 'loaded' && channelVideos.length > 0 && (() => {
              const RECS_PER_PAGE = 12;
              const totalPages = Math.ceil(channelVideos.length / RECS_PER_PAGE);
              const pageVideos = channelVideos.slice(recsPage * RECS_PER_PAGE, (recsPage + 1) * RECS_PER_PAGE);
              return React.createElement(
                'div',
                { className: 'mt-8' },
                // Section header + page indicator
                React.createElement(
                  'div',
                  { className: 'flex items-center justify-between mb-3' },
                  React.createElement(
                    'h2',
                    { className: 'text-sm font-semibold text-gray-400 uppercase tracking-wider' },
                    `From this channel${channelTitle ? ': ' + channelTitle : ''}`
                  ),
                  totalPages > 1 && React.createElement(
                    'span',
                    { className: 'text-xs text-gray-500' },
                    `Page ${recsPage + 1} of ${totalPages}`
                  )
                ),
                // Grid
                React.createElement(
                  'div',
                  { className: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3' },
                  pageVideos.map((v) =>
                    React.createElement(DataTile, {
                      key: v.videoId,
                      tileType: 'item',
                      item: videoToItem(v),
                      onSelect: () => { setCurrentVideoId(v.videoId); setRecsPage(0); },
                      onDelete: () => {},
                      onUpload: () => {},
                      uploadStatus: null,
                      readOnly: true,
                    })
                  )
                ),
                // Pagination controls
                totalPages > 1 && React.createElement(
                  'div',
                  { className: 'flex items-center justify-center gap-2 mt-4' },
                  React.createElement(
                    'button',
                    {
                      onClick: () => setRecsPage(p => p - 1),
                      disabled: recsPage === 0,
                      className: 'px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors',
                    },
                    '← Prev'
                  ),
                  // Page number buttons (show up to 5 around current page)
                  ...Array.from({ length: totalPages }, (_, i) => i)
                    .filter(i => Math.abs(i - recsPage) <= 2)
                    .map(i =>
                      React.createElement(
                        'button',
                        {
                          key: i,
                          onClick: () => setRecsPage(i),
                          className: i === recsPage
                            ? 'px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-bold'
                            : 'px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-600 transition-colors',
                        },
                        i + 1
                      )
                    ),
                  React.createElement(
                    'button',
                    {
                      onClick: () => setRecsPage(p => p + 1),
                      disabled: recsPage === totalPages - 1,
                      className: 'px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors',
                    },
                    'Next →'
                  )
                )
              );
            })()
          )

        // Channel / unrecognised URL — link fallback
        : React.createElement(
            'div',
            { className: 'flex flex-col items-center justify-center gap-6 py-12 bg-gray-800 rounded-2xl border border-gray-700' },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-red-500/70', fill: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
            ),
            React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Channel or playlist link — opens in YouTube'),
            React.createElement(
              'a',
              {
                href: url,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-xl transition-colors',
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
              ),
              'Open in YouTube'
            )
          )
    )
  );
};
