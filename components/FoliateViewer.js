
import React, { useEffect, useMemo, useRef, useState } from 'react';
import 'foliate-js/view.js';

/** @param {number} deg @param {number} w @param {number} h */
function rotationWrapStyle(deg, w, h) {
  const base = { position: 'absolute' };
  if (!w || !h) return { ...base, inset: 0 };
  if (deg === 0) return { ...base, inset: 0, transform: 'none' };
  if (deg === 180) {
    return {
      ...base,
      inset: 0,
      transform: 'rotate(180deg)',
      transformOrigin: 'center center',
    };
  }
  return {
    ...base,
    left: '50%',
    top: '50%',
    width: h,
    height: w,
    transform: `translate(-50%, -50%) rotate(${deg}deg)`,
    transformOrigin: 'center center',
  };
}

const BASE_CSS = `
  @namespace epub "http://www.idpf.org/2007/ops";
  p, li, blockquote, dd {
    line-height: 1.6;
    orphans: 2; widows: 2;
  }
  pre { white-space: pre-wrap !important; }
  aside[epub|type~="endnote"],
  aside[epub|type~="footnote"],
  aside[epub|type~="note"],
  aside[epub|type~="rearnote"] { display: none; }
`;

// Shift first spread so an even folio can sit on the left; keep this tiny so foliate
// does not insert full-height empty columns (which read as blank pages between turns).
const EVEN_LEFT_SPREAD_CSS = `
  body::before {
    content: "";
    display: block;
    width: 1px;
    height: 1px;
    margin-bottom: -1px;
    -webkit-column-break-after: always;
    break-after: column;
  }
`;

const SPREAD_SINGLE = 'single';
const SPREAD_DOUBLE_ODD_LEFT = 'double-odd-left';
const SPREAD_DOUBLE_EVEN_LEFT = 'double-even-left';

function setRendererColumnVars(renderer, count) {
  if (!renderer?.style) return;
  renderer.style.setProperty('--_max-column-count', String(count));
  renderer.style.setProperty('--_max-column-count-portrait', String(count));
}

/** Reflowable foliate-paginator only (not FXL / spine spread-manga). */
function applyReflowableSpread(view, flowMode, spreadLayout, isSpreadManga) {
  const r = view?.renderer;
  if (!r || view.isFixedLayout || isSpreadManga) return;

  if (flowMode === 'scrolled') {
    r.removeAttribute('max-column-count');
    setRendererColumnVars(r, 1);
    r.setStyles?.(BASE_CSS);
    return;
  }
  if (spreadLayout === SPREAD_SINGLE) {
    r.setAttribute('max-column-count', '1');
    setRendererColumnVars(r, 1);
    r.setStyles?.(BASE_CSS);
    return;
  }
  if (spreadLayout === SPREAD_DOUBLE_EVEN_LEFT) {
    r.setAttribute('max-column-count', '2');
    setRendererColumnVars(r, 2);
    r.setStyles?.(EVEN_LEFT_SPREAD_CSS + BASE_CSS);
    return;
  }
  r.setAttribute('max-column-count', '2');
  setRendererColumnVars(r, 2);
  r.setStyles?.(BASE_CSS);
}

// CSS injected into fixed-layout (fxl) iframes to hide Kindle overlay elements
const FXL_HIDE_CSS = `
  #PV, .PV-P { display: none !important; }
`;

function errorMessage(err) {
  if (err?.name === 'UnsupportedTypeError' || err?.message === 'File type not supported') {
    return 'This file format is not supported. AZW/KFX files purchased from Amazon with DRM cannot be opened — only DRM-free EPUB, MOBI, and AZW3 files are supported.';
  }
  return err?.message || 'Failed to open book.';
}

/**
 * IndexedDB-backed Blobs on Safari (especially iOS) often break when sliced or
 * re-wrapped as blob: URLs inside foliate-js / zip.js (WebKitBlobResource error 1).
 * Copy into a normal ArrayBuffer-backed File before open().
 * @param {Blob|ArrayBuffer|ArrayBufferView} data
 * @param {string} [name]
 * @param {string} [type]
 */
async function materializeAsFile(data, name, type) {
  if (data == null) throw new Error('No book data');
  let bytes = data;
  if (typeof data.arrayBuffer === 'function') {
    bytes = await data.arrayBuffer();
  }
  const mime = (type && String(type).trim()) || 'application/octet-stream';
  return new File([bytes], name || 'book', { type: mime, lastModified: Date.now() });
}

/** Paginator layout math assumes a non-zero host box; iPad can paint one frame at 0x0. */
function waitForLayout(el, { timeoutMs = 8000 } = {}) {
  if (!el) return Promise.resolve();
  const sized = () => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  if (sized()) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ro.disconnect();
      clearTimeout(tid);
      resolve();
    };
    const ro = new ResizeObserver(() => {
      if (sized()) finish();
    });
    ro.observe(el);
    const tid = setTimeout(finish, timeoutMs);
  });
}

/** Kindle/VIZ-style comics: every spine item has page-spread-* but no pre-paginated rendition (no display-options.xml). Foliate would use column "spread manga" mode and mis-paint image pages. */
function shouldReopenAsFixedSpreadComic(view) {
  if (view.isFixedLayout) return false;
  const sections = view.book?.sections ?? [];
  if (!sections.length) return false;
  if (!sections.every(s => s.pageSpread != null)) return false;
  return view.book?.rendition?.layout !== 'pre-paginated';
}

/**
 * Some kepub comic files omit page-spread metadata but each spine item is still
 * a single image page. Re-open those as fixed-layout so facing-page behavior is
 * handled by foliate-fxl rather than reflow pagination.
 */
async function shouldReopenAsFixedImageComic(view) {
  if (view.isFixedLayout) return false;
  const sections = view.book?.sections ?? [];
  if (sections.length < 8) return false;

  const sample = sections.slice(0, Math.min(8, sections.length));
  let imagePageCount = 0;
  let checked = 0;

  for (const section of sample) {
    if (typeof section?.createDocument !== 'function') continue;
    try {
      const doc = await section.createDocument();
      const body = doc?.body;
      if (!body) continue;
      checked += 1;
      const text = (body.textContent || '').replace(/\s+/g, '');
      const images = body.querySelectorAll('img, svg image, object[type^="image/"]');
      if (images.length === 1 && text.length <= 20) imagePageCount += 1;
    } catch (_) {
      // Ignore parse failures and continue sampling.
    }
  }

  if (!checked) return false;
  return imagePageCount >= Math.max(3, Math.ceil(checked * 0.7));
}

export const FoliateViewer = ({ data, name, type, itemId, initialReadingPosition, onSaveReadingPosition, storeName }) => {
  const viewportRef = useRef(null);
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const saveRef = useRef({ onSaveReadingPosition, itemId, storeName });
  const sectionIndexRef = useRef(0);
  const isSpreadMangaRef = useRef(false);
  const flowModeRef = useRef('scrolled');
  const spreadLayoutRef = useRef(SPREAD_DOUBLE_ODD_LEFT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flowMode, setFlowMode] = useState('scrolled');
  const [spreadLayout, setSpreadLayout] = useState(SPREAD_DOUBLE_ODD_LEFT);
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  flowModeRef.current = flowMode;
  spreadLayoutRef.current = spreadLayout;

  useEffect(() => {
    saveRef.current = { onSaveReadingPosition, itemId, storeName };
  }, [onSaveReadingPosition, itemId, storeName]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setViewportSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wrapStyle = useMemo(
    () => rotationWrapStyle(rotationDeg, viewportSize.w, viewportSize.h),
    [rotationDeg, viewportSize.w, viewportSize.h],
  );

  useEffect(() => {
    if (isLoading || error || isFixedLayout) return;
    const view = viewRef.current;
    if (!view || isSpreadMangaRef.current) return;
    applyReflowableSpread(view, flowMode, spreadLayout, isSpreadMangaRef.current);
  }, [spreadLayout, flowMode, isLoading, error, isFixedLayout]);

  useEffect(() => {
    if (!data || !containerRef.current) return;

    setIsLoading(true);
    setError(null);
    setIsFixedLayout(false);
    isSpreadMangaRef.current = false;
    sectionIndexRef.current = 0;
    let cancelled = false;

    const container = containerRef.current;
    let view = document.createElement('foliate-view');
    view.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(view);
    viewRef.current = view;

    // Inject hide-overlay CSS into each fxl iframe as it loads
    const onLoad = e => {
      const frame = e.detail?.iframe ?? e.target;
      try {
        const doc = frame?.contentDocument;
        if (!doc) return;
        if (!doc.getElementById('--foliate-hide-overlays')) {
          const s = doc.createElement('style');
          s.id = '--foliate-hide-overlays';
          s.textContent = FXL_HIDE_CSS;
          (doc.head || doc.documentElement).appendChild(s);
        }
      } catch (_) {}
    };

    (async () => {
      try {
        await waitForLayout(container);
        const file = await materializeAsFile(data, name, type);
        await view.open(file);
        if (cancelled) return;

        let fxl = !!view.isFixedLayout;
        let sections = view.book?.sections ?? [];
        if (shouldReopenAsFixedSpreadComic(view) || await shouldReopenAsFixedImageComic(view)) {
          const book = view.book;
          book.rendition = {
            ...book.rendition,
            layout: 'pre-paginated',
            spread: book.rendition?.spread ?? 'both',
          };
          // Do not rely on view.close(): Paginator.destroy() throws if no spine frame ever
          // mounted (#view still undefined). That can happen in production (timing/chunks).
          try {
            view.close();
          } catch (_) { /* ignore */ }
          if (container.contains(view)) container.removeChild(view);
          const next = document.createElement('foliate-view');
          next.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;';
          container.appendChild(next);
          view = next;
          viewRef.current = view;
          await view.open(book);
          if (cancelled) return;
          fxl = !!view.isFixedLayout;
          sections = view.book?.sections ?? [];
        }

        // Reflow spine with page-spread on every item (true spread-manga in reflow mode only)
        const isSpreadManga = !fxl && sections.length > 0
            && sections.every(s => s.pageSpread != null);
        isSpreadMangaRef.current = isSpreadManga;
        setIsFixedLayout(fxl || isSpreadManga);

        if (fxl) {
          // foliate-fxl ignores 'flow'; lock to paginated and inject CSS on frame load
          setFlowMode('paginated');
          view.addEventListener('load', onLoad);
        } else if (isSpreadManga) {
          // Paginator used for spread manga: scrolled flow so no blank boundary columns exist;
          // navigation uses view.goTo(index) directly to skip section transitions cleanly.
          view.renderer.setAttribute('flow', 'scrolled');
          view.renderer.setStyles?.(BASE_CSS);
          setFlowMode('paginated');
          // Track current section index so goTo navigation is correct
          view.renderer.addEventListener('relocate', e => {
            if (e.detail?.index != null) sectionIndexRef.current = e.detail.index;
          });
        } else {
          // Match persisted flow mode; default scrolled avoids blank boundary columns on first paint.
          view.renderer.setAttribute('flow', flowModeRef.current);
          applyReflowableSpread(view, flowModeRef.current, spreadLayoutRef.current, false);
        }

        view.addEventListener('relocate', e => {
          const { cfi } = e.detail;
          if (!cfi) return;
          const { onSaveReadingPosition: save, itemId: id, storeName: store } = saveRef.current;
          if (save && id && store) save(id, store, { kind: 'foliate-cfi', cfi }).catch(() => {});
        });

        const savedCfi = initialReadingPosition?.cfi ?? null;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (savedCfi) {
          await view.goTo(savedCfi);
        } else {
          await view.renderer.next();
        }
        if (cancelled) return;

        if (!fxl && !isSpreadManga) {
          applyReflowableSpread(view, flowModeRef.current, spreadLayoutRef.current, false);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('[FoliateViewer] Failed to open book:', err);
        if (!cancelled) {
          setError(errorMessage(err));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      view.removeEventListener('load', onLoad);
      viewRef.current = null;
      if (container.contains(view)) container.removeChild(view);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevPage = () => {
    const view = viewRef.current;
    if (!view) return;
    if (isSpreadMangaRef.current) {
      const idx = sectionIndexRef.current - 1;
      if (idx >= 0) view.goTo(idx);
    } else {
      view.prev();
    }
  };
  const nextPage = () => {
    const view = viewRef.current;
    if (!view) return;
    if (isSpreadMangaRef.current) {
      const total = view.book?.sections?.length ?? 0;
      const idx = sectionIndexRef.current + 1;
      if (idx < total) view.goTo(idx);
    } else {
      view.next();
    }
  };

  const toggleLayout = () => {
    setFlowMode(prev => {
      const next = prev === 'scrolled' ? 'paginated' : 'scrolled';
      viewRef.current?.renderer?.setAttribute('flow', next);
      return next;
    });
  };

  const edgeNavClass =
    'pointer-events-auto absolute top-0 bottom-0 z-[70] w-[min(40%,220px)] min-w-[52px] border-0 p-0 cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] bg-transparent active:bg-black/10 sm:hover:bg-black/[0.06] transform-gpu';

  return React.createElement(
    'div',
    { className: 'relative flex flex-col flex-1 min-h-0 w-full bg-gray-900' },

    (isLoading || error) && React.createElement(
      'div',
      { className: 'absolute inset-0 flex items-center justify-center bg-gray-900 z-[80]' },
      error
        ? React.createElement('p', { className: 'text-red-400 text-sm text-center max-w-sm px-4' }, error)
        : React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Loading book…')
    ),

    React.createElement(
      'div',
      { className: 'relative flex-1 min-h-0 w-full overflow-hidden isolate' },
      React.createElement(
        'div',
        {
          ref: viewportRef,
          className: 'absolute inset-0 z-0 bg-white overflow-hidden',
        },
        React.createElement(
          'div',
          { style: wrapStyle },
          React.createElement('div', {
            ref: containerRef,
            className: 'absolute inset-0 z-0 min-w-0 min-h-0 w-full h-full',
          }),
        ),
      ),
      !isLoading && !error && flowMode === 'paginated' && React.createElement(
        'div',
        { className: 'pointer-events-none absolute inset-0 z-[60]', 'aria-hidden': true },
        React.createElement('button', {
          type: 'button',
          onClick: e => { e.stopPropagation(); prevPage(); },
          className: `${edgeNavClass} left-0`,
          'aria-label': 'Previous page',
        }),
        React.createElement('button', {
          type: 'button',
          onClick: e => { e.stopPropagation(); nextPage(); },
          className: `${edgeNavClass} right-0`,
          'aria-label': 'Next page',
        })
      )
    ),

    React.createElement(
      'div',
      {
        className: 'flex shrink-0 flex-wrap justify-center items-center gap-3 sm:gap-4 bg-gray-800 px-3 py-3 sm:py-2.5 border-t border-gray-700/80',
        style: { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' },
      },
      !isFixedLayout && !isLoading && !error && React.createElement(
        'label',
        { className: 'flex min-h-[44px] items-center gap-2 text-gray-300 text-xs sm:text-sm shrink-0' },
        'Spread',
        React.createElement('select', {
          className: 'max-w-[10.5rem] sm:max-w-[14rem] rounded-md border border-gray-600 bg-gray-900 px-2 py-2 text-sm text-white',
          value: spreadLayout,
          title: flowMode === 'scrolled' ? 'Switch to paginated mode to use spread layout.' : undefined,
          disabled: flowMode === 'scrolled',
          'aria-label': 'Page spread layout',
          onChange: e => { setSpreadLayout(e.target.value); },
        },
        React.createElement('option', { value: SPREAD_SINGLE }, 'Single page'),
        React.createElement('option', { value: SPREAD_DOUBLE_ODD_LEFT }, 'Two pages (odd on left)'),
        React.createElement('option', { value: SPREAD_DOUBLE_EVEN_LEFT }, 'Two pages (even on left)'),
      )),
      (flowMode === 'paginated') && React.createElement('button', {
        type: 'button',
        onClick: prevPage,
        className: 'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-indigo-600 text-white text-sm sm:text-base rounded-lg hover:bg-indigo-700 transition-colors touch-manipulation',
      }, 'Previous'),
      (flowMode === 'paginated') && React.createElement('button', {
        type: 'button',
        onClick: nextPage,
        className: 'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-indigo-600 text-white text-sm sm:text-base rounded-lg hover:bg-indigo-700 transition-colors touch-manipulation',
      }, 'Next'),
      !isFixedLayout && React.createElement('button', {
        type: 'button',
        onClick: toggleLayout,
        className: 'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-gray-700 text-white text-sm sm:text-base rounded-lg hover:bg-gray-600 transition-colors touch-manipulation',
        'aria-pressed': flowMode === 'paginated',
      }, flowMode === 'scrolled' ? 'Paginated' : 'Scrolled'),
      !isLoading && !error && React.createElement('button', {
        type: 'button',
        onClick: () => { setRotationDeg(d => (d + 90) % 360); },
        className: 'min-h-[44px] min-w-[44px] px-4 py-2.5 sm:py-2 bg-gray-700 text-white text-sm sm:text-base rounded-lg hover:bg-gray-600 transition-colors touch-manipulation',
        'aria-label': `Rotate view (currently ${rotationDeg} degrees)`,
        title: 'Rotate 90°',
      }, rotationDeg === 0 ? 'Rotate' : `${rotationDeg}°`)
    )
  );
};
