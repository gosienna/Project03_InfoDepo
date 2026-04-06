
import React, { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';

/** Margin fraction (each side) for prev/next tap — matches overlay intent. */
const EDGE_FRAC = 0.28;
const EDGE_MAX_PX = 220;
const NAV_DEBOUNCE_MS = 420;

function registerIframeEdgeNavigation(rendition) {
  let lastNav = 0;

  const nav = (fn) => {
    const t = Date.now();
    if (t - lastNav < NAV_DEBOUNCE_MS) return;
    lastNav = t;
    fn();
  };

  rendition.hooks.content.register((contents) => {
    const doc = contents.document;
    const win = contents.window;
    if (!doc || !win) return;

    const edgeMargin = () => {
      const w = win.innerWidth || doc.documentElement.clientWidth || 1;
      return Math.min(w * EDGE_FRAC, EDGE_MAX_PX);
    };

    const tryEdge = (clientX) => {
      const w = win.innerWidth || doc.documentElement.clientWidth || 1;
      const m = edgeMargin();
      if (clientX <= m) {
        nav(() => rendition.prev());
        return true;
      }
      if (clientX >= w - m) {
        nav(() => rendition.next());
        return true;
      }
      return false;
    };

    const isInteractive = (target) => {
      if (!target || !target.closest) return false;
      return !!target.closest(
        'a, button, input, textarea, select, label, video, audio, [role="link"], [onclick]'
      );
    };

    let touchT = 0;
    let touchX = 0;
    let touchY = 0;

    doc.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        touchT = Date.now();
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
      },
      { passive: true }
    );

    doc.addEventListener(
      'touchend',
      (e) => {
        if (e.changedTouches.length !== 1) return;
        const x = e.changedTouches[0].clientX;
        const y = e.changedTouches[0].clientY;
        if (Date.now() - touchT > 550) return;
        if (Math.abs(x - touchX) > 28 || Math.abs(y - touchY) > 45) return;
        if (isInteractive(e.target)) return;
        if (tryEdge(x)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true, passive: false }
    );

    doc.addEventListener(
      'click',
      (e) => {
        if (isInteractive(e.target)) return;
        if (tryEdge(e.clientX)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );

    doc.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerType === 'touch') return;
        if (isInteractive(e.target)) return;
        if (tryEdge(e.clientX)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
  });
}

export const EpubViewer = ({ data }) => {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (data && viewerRef.current) {
      setIsLoading(true);
      const arrayBufferPromise = data.arrayBuffer();

      arrayBufferPromise
        .then((arrayBuffer) => {
          const book = ePub(arrayBuffer);
          bookRef.current = book;
          const rendition = book.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: 'auto',
            flow: 'paginated',
            allowScriptedContent: true,
          });
          renditionRef.current = rendition;

          registerIframeEdgeNavigation(rendition);

          rendition.display().then(() => {
            setIsLoading(false);
          });
        })
        .catch((err) => {
          console.error('Error loading epub: ', err);
          setIsLoading(false);
        });

      return () => {
        if (bookRef.current) {
          bookRef.current.destroy();
        }
      };
    }
  }, [data]);

  const goToNextPage = () => {
    if (renditionRef.current) {
      renditionRef.current.next();
    }
  };

  const goToPrevPage = () => {
    if (renditionRef.current) {
      renditionRef.current.prev();
    }
  };

  const edgeNavClass =
    'pointer-events-auto absolute top-0 bottom-0 z-[70] w-[min(40%,220px)] min-w-[52px] border-0 p-0 cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] bg-transparent active:bg-black/10 sm:hover:bg-black/[0.06] transform-gpu';

  return React.createElement(
    'div',
    { className: 'relative flex flex-col flex-1 min-h-0 w-full bg-gray-900' },
    isLoading &&
      React.createElement(
        'div',
        { className: 'absolute inset-0 flex items-center justify-center bg-gray-900 z-[80]' },
        React.createElement('p', null, 'Loading E-book...')
      ),
    React.createElement(
      'div',
      { className: 'relative flex-1 min-h-0 w-full overflow-hidden isolate' },
      React.createElement('div', {
        ref: viewerRef,
        className: 'absolute inset-0 z-0 bg-white text-black overflow-hidden',
      }),
      !isLoading &&
        React.createElement(
          'div',
          {
            className: 'pointer-events-none absolute inset-0 z-[60]',
            'aria-hidden': true,
          },
          React.createElement('button', {
            type: 'button',
            onClick: (e) => {
              e.stopPropagation();
              goToPrevPage();
            },
            className: `${edgeNavClass} left-0`,
            'aria-label': 'Previous page',
            title: 'Previous page',
          }),
          React.createElement('button', {
            type: 'button',
            onClick: (e) => {
              e.stopPropagation();
              goToNextPage();
            },
            className: `${edgeNavClass} right-0`,
            'aria-label': 'Next page',
            title: 'Next page',
          })
        )
    ),
    React.createElement(
      'div',
      {
        className:
          'flex shrink-0 justify-center items-center gap-3 sm:gap-4 bg-gray-800 px-3 py-3 sm:py-2.5 border-t border-gray-700/80',
        style: { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' },
      },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: goToPrevPage,
          className:
            'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-indigo-600 text-white text-sm sm:text-base rounded-lg hover:bg-indigo-700 transition-colors touch-manipulation',
        },
        'Previous'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: goToNextPage,
          className:
            'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-indigo-600 text-white text-sm sm:text-base rounded-lg hover:bg-indigo-700 transition-colors touch-manipulation',
        },
        'Next'
      )
    )
  );
};
