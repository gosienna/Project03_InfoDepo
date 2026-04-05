
import React, { useState, useMemo } from 'react';
import { VideoCard } from './VideoCard.js';

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

function formatViewCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

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

export const YoutubeChannelViewer = ({ channel, onBack, onSelectItem, onDeleteChannel }) => {
  const [sortMode, setSortMode] = useState('newest');

  const sortedVideos = useMemo(() => {
    const vids = [...(channel.videos || [])];
    vids.sort(sortFns[sortMode] || sortFns.newest);
    return vids;
  }, [channel.videos, sortMode]);

  const libraryItems = useMemo(
    () => sortedVideos.map(videoToLibraryItem),
    [sortedVideos]
  );

  const handleSelect = (item) => {
    if (onSelectItem) onSelectItem(item);
  };

  const handleDeleteChannel = () => {
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
          (channel.videos || []).length,
          ' videos'
        )
      ),
      // Delete channel button
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

    // Sort bar
    React.createElement(
      'div',
      { className: 'flex items-center gap-2 mb-4 flex-wrap' },
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
    ),

    // Video grid
    sortedVideos.length > 0
      ? React.createElement(
          'div',
          { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6' },
          libraryItems.map((item) => {
            const cv = item._channelVideo;
            return React.createElement(
              'div',
              { key: cv.videoId, className: 'relative' },
              React.createElement(VideoCard, {
                video: item,
                onSelect: handleSelect,
                onDelete: () => {},
                onUpload: () => {},
                uploadStatus: null,
              }),
              // Overlay: view count + date
              React.createElement(
                'div',
                { className: 'flex items-center justify-between px-4 pb-2 -mt-2 text-xs text-gray-500' },
                React.createElement('span', null, formatViewCount(cv.viewCount), ' views'),
                React.createElement('span', null, new Date(cv.publishedAt).toLocaleDateString())
              )
            );
          })
        )
      : React.createElement(
          'div',
          { className: 'text-center py-20 text-gray-500' },
          'No videos found for this channel (Shorts are excluded).'
        )
  );
};
