
import React, { useState, useRef, useEffect } from 'react';
import { resolveChannelId, fetchChannelVideos } from '../utils/youtubeApi.js';
import { getDriveCredentials, hasGoogleApiKeyOrProxy } from '../utils/driveCredentials.js';

const CHANNEL_URL_RE = /youtube\.com\/(@[a-zA-Z0-9_.-]+|channel\/UC[a-zA-Z0-9_-]{22})/;

export const NewChannelModal = ({ onSave, onClose }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [progress, setProgress] = useState('');
  const urlRef = useRef(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!CHANNEL_URL_RE.test(trimmed)) {
      setError('Please enter a valid YouTube channel URL (e.g. https://www.youtube.com/@stanfordonline)');
      return;
    }
    if (!hasGoogleApiKeyOrProxy(getDriveCredentials())) {
      setError('YouTube API not configured. Set VITE_API_KEY locally or GOOGLE_API_KEY + VITE_GOOGLE_API_PROXY on Netlify.');
      return;
    }

    setIsFetching(true);
    setError(null);
    setProgress('Resolving channel...');
    try {
      const channelInfo = await resolveChannelId(trimmed);
      setProgress('Fetching videos...');
      const videos = await fetchChannelVideos(channelInfo.channelId, setProgress);
      const saveResult = await onSave({
        channelId: channelInfo.channelId,
        handle: channelInfo.handle,
        name: channelInfo.name,
        thumbnailUrl: channelInfo.thumbnailUrl,
        videos,
      });
      if (saveResult === 'updated') {
        window.alert('This channel already exists. Its videos were refreshed.');
      }
      onClose();
    } catch (err) {
      console.error('Channel fetch failed:', err);
      setError(err?.message || 'Failed to fetch channel data.');
    } finally {
      setIsFetching(false);
      setProgress('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !isFetching) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
      onKeyDown: handleKeyDown,
    },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col border border-gray-700' },

      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5 text-red-500', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', { d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z' })
          ),
          React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'Add YouTube Channel')
        ),
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700 transition-colors',
            title: 'Close',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),

      // Body
      React.createElement(
        'div',
        { className: 'flex flex-col gap-4 p-6' },
        React.createElement(
          'div',
          { className: 'flex flex-col gap-1' },
          React.createElement('label', { className: 'text-sm font-medium text-gray-400', htmlFor: 'ch-url' }, 'Channel URL'),
          React.createElement('input', {
            id: 'ch-url',
            ref: urlRef,
            type: 'url',
            value: url,
            onChange: (e) => { setUrl(e.target.value); setError(null); },
            placeholder: 'https://www.youtube.com/@stanfordonline',
            disabled: isFetching,
            className: 'bg-gray-700 border border-gray-600 text-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 placeholder-gray-500 disabled:opacity-50',
          }),
          React.createElement('p', { className: 'text-xs text-gray-500 mt-1' },
            'Supports youtube.com/@handle and youtube.com/channel/UC... URLs'
          ),
          error && React.createElement('p', { className: 'text-xs text-red-400 mt-1' }, error)
        ),

        isFetching && React.createElement(
          'div',
          { className: 'flex items-center gap-2 text-sm text-gray-400' },
          React.createElement('div', { className: 'h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin' }),
          progress || 'Working...'
        )
      ),

      // Footer
      React.createElement(
        'div',
        { className: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700' },
        React.createElement(
          'button',
          {
            onClick: onClose,
            disabled: isFetching,
            className: 'px-5 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-gray-100 hover:bg-gray-700 transition-colors disabled:opacity-40',
          },
          'Cancel'
        ),
        React.createElement(
          'button',
          {
            onClick: handleSubmit,
            disabled: !url.trim() || isFetching,
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          isFetching ? 'Fetching...' : 'Add Channel'
        )
      )
    )
  );
};
