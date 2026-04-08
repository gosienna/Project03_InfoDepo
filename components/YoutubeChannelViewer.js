
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DataTile } from './DataTile.js';
import { fetchNewChannelVideos } from '../utils/youtubeApi.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from '../utils/driveCredentials.js';

const SORT_MODES = [
  { key: 'newest',      label: 'Newest First' },
  { key: 'oldest',      label: 'Oldest First' },
  { key: 'most_viewed', label: 'Most Viewed' },
  { key: 'least_viewed', label: 'Least Viewed' },
];

const sortFns = {
  newest:      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  oldest:      (a, b) => new Date(a.publishedAt) - new Date(b.publishedAt),
  most_viewed: (a, b) => b.viewCount - a.viewCount,
  least_viewed:(a, b) => a.viewCount - b.viewCount,
};

const VIDEOS_PER_PAGE = 20;

function videoToLibraryItem(v) {
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

// 'idle' | 'checking' | 'found' | 'error'
const REFRESH_STATUS_LABELS = {
  checking: 'Checking for new videos…',
  found: 'New videos added!',
  error: 'Could not check for new videos.',
};

export const YoutubeChannelViewer = ({
  channel,
  onBack,
  onSelectItem,
  onDeleteChannel,
  onRequestDeleteChannel,
  onUpdateChannel,
  readOnly,
}) => {
  const [sortMode, setSortMode] = useState('newest');
  const [pageIndex, setPageIndex] = useState(0);
  const [titleSearch, setTitleSearch] = useState('');
  const [featuredVideoId, setFeaturedVideoId] = useState(null);
  const [refreshStatus, setRefreshStatus] = useState('idle');
  const refreshedChannelIdRef = useRef(null);

  // On mount (or when the channel changes), check for new videos.
  useEffect(() => {
    if (!onUpdateChannel) return;
    if (!hasGoogleApiKeyOrProxy(getDriveCredentials())) return;
    // Avoid re-checking the same channel if it was already refreshed this session.
    if (refreshedChannelIdRef.current === channel.id) return;
    refreshedChannelIdRef.current = channel.id;

    setRefreshStatus('checking');
    fetchNewChannelVideos(channel)
      .then((newVideos) => {
        if (newVideos.length > 0) {
          const merged = [...newVideos, ...(channel.videos || [])];
          onUpdateChannel(channel.id, { videos: merged, lastRefreshedAt: new Date() });
          setRefreshStatus('found');
        } else {
          onUpdateChannel(channel.id, { lastRefreshedAt: new Date() });
          setRefreshStatus('idle');
        }
        setTimeout(() => setRefreshStatus('idle'), 4000);
      })
      .catch((err) => {
        console.warn('[InfoDepo] Channel viewer refresh failed:', err);
        setRefreshStatus('error');
        setTimeout(() => setRefreshStatus('idle'), 4000);
      });
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const vids = Array.isArray(channel.videos) ? channel.videos.filter((v) => typeof v?.videoId === 'string' && v.videoId.trim()) : [];
    if (!vids.length) {
      setFeaturedVideoId(null);
      return;
    }
    const fromTile = typeof channel._featuredVideoId === 'string' ? channel._featuredVideoId.trim() : '';
    if (fromTile && vids.some((v) => v.videoId === fromTile)) {
      setFeaturedVideoId(fromTile);
      return;
    }
    const idx = Math.floor(Math.random() * vids.length);
    setFeaturedVideoId(vids[idx].videoId);
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawCount = (channel.videos || []).length;

  const filteredByTitle = useMemo(() => {
    const list = channel.videos || [];
    const q = titleSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((v) => (v.title || '').toLowerCase().includes(q));
  }, [channel.videos, titleSearch]);

  const sortedVideos = useMemo(() => {
    const vids = [...filteredByTitle];
    vids.sort(sortFns[sortMode] || sortFns.newest);
    return vids;
  }, [filteredByTitle, sortMode]);

  const displayVideos = useMemo(() => {
    if (!featuredVideoId) return sortedVideos;
    const featured = sortedVideos.find((v) => v.videoId === featuredVideoId);
    if (!featured) return sortedVideos;
    return [featured, ...sortedVideos.filter((v) => v.videoId !== featuredVideoId)];
  }, [sortedVideos, featuredVideoId]);

  const totalVideos = displayVideos.length;
  const totalPages = Math.max(1, Math.ceil(totalVideos / VIDEOS_PER_PAGE));

  useEffect(() => {
    setPageIndex(0);
  }, [sortMode, channel.id, titleSearch]);

  useEffect(() => {
    const maxIdx = Math.max(0, totalPages - 1);
    if (pageIndex > maxIdx) setPageIndex(maxIdx);
  }, [totalPages, pageIndex]);

  const pageVideos = useMemo(() => {
    const start = pageIndex * VIDEOS_PER_PAGE;
    return displayVideos.slice(start, start + VIDEOS_PER_PAGE);
  }, [displayVideos, pageIndex]);

  const libraryItems = useMemo(
    () => pageVideos.map(videoToLibraryItem),
    [pageVideos]
  );

  const handleSelect = (item) => {
    if (onSelectItem) onSelectItem(item);
  };

  const handleDeleteChannel = () => {
    if (readOnly) return;
    if (onRequestDeleteChannel) {
      onRequestDeleteChannel(channel);
      return;
    }
    if (window.confirm(`Remove channel "${channel.name}" from your library?`)) {
      onDeleteChannel(channel.id);
      onBack();
    }
  };

  return React.createElement(
    'div',
    { className: 'w-full' },

    // Channel header
    React.createElement(
      'div',
      { className: 'flex items-center gap-4 mb-6 flex-wrap' },
      // Back button
      React.createElement(
        'button',
        {
          onClick: onBack,
          className: 'p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-700',
          'aria-label': 'Back to Library',
        },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-6 w-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 19l-7-7 7-7' })
        )
      ),
      // Channel avatar
      channel.thumbnailUrl && React.createElement('img', {
        src: channel.thumbnailUrl,
        alt: channel.name,
        className: 'h-12 w-12 rounded-full object-cover border-2 border-gray-600',
      }),
      // Channel info
      React.createElement(
        'div',
        { className: 'flex-1 min-w-0' },
        React.createElement('h2', { className: 'text-2xl font-bold text-gray-100 truncate' }, channel.name),
        React.createElement(
          'p',
          { className: 'text-sm text-gray-400' },
          channel.handle,
          ' \u00B7 ',
          rawCount,
          ' videos',
          titleSearch.trim() &&
            sortedVideos.length !== rawCount &&
            ` \u00B7 ${sortedVideos.length} match${sortedVideos.length === 1 ? '' : 'es'}`
        )
      ),
      // Refresh status badge
      refreshStatus !== 'idle' &&
        React.createElement(
          'span',
          {
            className:
              refreshStatus === 'checking'
                ? 'text-xs text-gray-400 animate-pulse'
                : refreshStatus === 'found'
                ? 'text-xs text-green-400 font-medium'
                : 'text-xs text-red-400',
          },
          REFRESH_STATUS_LABELS[refreshStatus]
        ),
      // Delete channel button
      !readOnly &&
      React.createElement(
        'button',
        {
          onClick: handleDeleteChannel,
          className: 'p-2 rounded-xl text-red-500 hover:text-white hover:bg-red-600 transition-colors border border-red-900/50',
          title: 'Remove channel',
        },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })
        )
      )
    ),

    // Search + sort
    rawCount > 0 &&
      React.createElement(
        'div',
        { className: 'mb-4 flex flex-col gap-3' },
        React.createElement(
          'div',
          { className: 'relative max-w-xl' },
          React.createElement(
            'svg',
            {
              xmlns: 'http://www.w3.org/2000/svg',
              className: 'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none',
              fill: 'none',
              viewBox: '0 0 24 24',
              stroke: 'currentColor',
            },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
          ),
          React.createElement('input', {
            type: 'search',
            value: titleSearch,
            onChange: (e) => setTitleSearch(e.target.value),
            placeholder: 'Search by video title...',
            'aria-label': 'Filter videos by title',
            className:
              'w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors',
          }),
          titleSearch &&
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => setTitleSearch(''),
                className: 'absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors',
                'aria-label': 'Clear search',
              },
              React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
              )
            )
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-2 flex-wrap' },
          React.createElement('span', { className: 'text-sm text-gray-500 font-medium' }, 'Sort by:'),
          ...SORT_MODES.map(({ key, label }) =>
            React.createElement(
              'button',
              {
                key,
                onClick: () => setSortMode(key),
                className: sortMode === key
                  ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-red-700 text-white transition-colors'
                  : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors border border-gray-700',
              },
              label
            )
          )
        )
      ),

    // Video grid + pagination
    rawCount === 0
      ? React.createElement(
          'div',
          { className: 'text-center py-20 text-gray-500' },
          'No videos found for this channel (Shorts are excluded).'
        )
      : sortedVideos.length === 0
        ? React.createElement(
            'div',
            { className: 'text-center py-20 text-gray-500' },
            titleSearch.trim()
              ? `No videos matching "${titleSearch.trim()}"`
              : 'No videos found for this channel (Shorts are excluded).'
          )
        : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
              libraryItems.map((item) =>
                React.createElement(DataTile, {
                  key: item.id,
                  tileType: 'item',
                  item,
                  onSelect: handleSelect,
                  onDelete: () => {},
                  onUpload: () => {},
                  uploadStatus: null,
                })
              )
            ),
            totalPages > 1 &&
              React.createElement(
                'div',
                { className: 'flex flex-col sm:flex-row items-center justify-center gap-4 mt-10 pt-6 border-t border-gray-800' },
                React.createElement(
                  'p',
                  { className: 'text-sm text-gray-400 order-2 sm:order-1' },
                  'Showing ',
                  pageIndex * VIDEOS_PER_PAGE + 1,
                  '\u2013',
                  Math.min((pageIndex + 1) * VIDEOS_PER_PAGE, totalVideos),
                  ' of ',
                  totalVideos
                ),
                React.createElement(
                  'div',
                  { className: 'flex items-center gap-2 order-1 sm:order-2' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setPageIndex((p) => Math.max(0, p - 1)),
                      disabled: pageIndex <= 0,
                      className:
                        'px-4 py-2 rounded-lg text-sm font-medium border transition-colors ' +
                        (pageIndex <= 0
                          ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                          : 'border-gray-600 text-gray-200 hover:bg-gray-800'),
                    },
                    'Previous'
                  ),
                  React.createElement(
                    'span',
                    { className: 'text-sm text-gray-500 px-2 min-w-[5rem] text-center' },
                    'Page ',
                    pageIndex + 1,
                    ' / ',
                    totalPages
                  ),
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setPageIndex((p) => Math.min(totalPages - 1, p + 1)),
                      disabled: pageIndex >= totalPages - 1,
                      className:
                        'px-4 py-2 rounded-lg text-sm font-medium border transition-colors ' +
                        (pageIndex >= totalPages - 1
                          ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                          : 'border-gray-600 text-gray-200 hover:bg-gray-800'),
                    },
                    'Next'
                  )
                )
              )
          )
  );
};
