
import React, { useState, useEffect } from 'react';

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoId(url) {
  const m = (url || '').match(YT_VIDEO_ID_RE);
  return m ? m[1] : null;
}

export const YoutubeViewer = ({ video }) => {
  const [parsed,    setParsed]    = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState(null);

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

  const url     = parsed?.url || '';
  const title   = parsed?.title || 'YouTube Video';
  const videoId = extractVideoId(url);

  return React.createElement(
    'div',
    { className: 'w-full h-full flex flex-col items-center bg-gray-900 p-6 overflow-y-auto' },

    // Title
    React.createElement(
      'h1',
      { className: 'text-xl font-bold text-gray-100 mb-4 text-center max-w-2xl w-full' },
      title
    ),

    // Content area
    React.createElement(
      'div',
      { className: 'w-full max-w-3xl' },

      videoId
        // Embedded player
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { style: { position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '12px', overflow: 'hidden' } },
              React.createElement('iframe', {
                src: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
                title,
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
                allowFullScreen: true,
                style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' },
              })
            ),
            React.createElement(
              'div',
              { className: 'flex justify-center mt-4' },
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
