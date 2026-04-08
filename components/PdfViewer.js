
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

async function renderPageToCanvas(page, containerWidth) {
  const base = page.getViewport({ scale: 1 });
  const padding = 16;
  const cssW = Math.max(100, containerWidth - padding * 2);
  const userScale = cssW / base.width;
  const outputScale = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: userScale * outputScale });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / outputScale}px`;
  canvas.style.height = `${viewport.height / outputScale}px`;
  canvas.className = 'max-w-full shadow-md rounded bg-white';

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function isExpectedPdfCancellation(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    name === 'RenderingCancelledException' ||
    name === 'AbortException' ||
    msg.includes('rendering cancelled') ||
    msg.includes('rendering canceled') ||
    msg.includes('abort')
  );
}

export const PdfViewer = ({
  data,
  itemId,
  initialReadingPosition,
  onUpdateItem,
  onSaveReadingPosition,
  storeName,
  readOnly,
}) => {
  const containerRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const pdfDocRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorText, setErrorText] = useState('');
  const runIdRef = useRef(0);
  const didRestoreScrollRef = useRef(false);
  const lastSavedPositionKeyRef = useRef(null);
  const saveScrollDebounceRef = useRef(null);
  const useWindowScrollRef = useRef(false);
  const lastKnownPageRef = useRef(1);
  const lastUserScrollAtRef = useRef(0);

  // pageWrappers holds DOM nodes (position:relative divs) created during PDF render.
  // We use React state so portals re-render when pages change.
  const [pageWrappers, setPageWrappers] = useState([]);

  // Annotation state
  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  const [tool, setTool] = useState('none'); // 'none' | 'highlight' | 'text' | 'line'
  const toolRef = useRef('none');
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const [drag, setDrag] = useState(null); // { pageIndex, startX, startY, curX, curY }
  const dragRef = useRef(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const [textDraft, setTextDraft] = useState(null); // { pageIndex, x, y, text }
  const [lineDraft, setLineDraft] = useState(null); // { pageIndex, startX, startY, curX, curY }
  const [textColor, setTextColor] = useState('black');
  const [textFontSize, setTextFontSize] = useState(14);

  const TEXT_COLOR_OPTIONS = [
    { id: 'black', label: 'Black', css: '#111827', rgb: [0.07, 0.09, 0.16] },
    { id: 'grey', label: 'Grey', css: '#6b7280', rgb: [0.42, 0.45, 0.5] },
    { id: 'red', label: 'Red', css: '#dc2626', rgb: [0.86, 0.15, 0.15] },
    { id: 'blue', label: 'Blue', css: '#2563eb', rgb: [0.15, 0.39, 0.92] },
    { id: 'green', label: 'Green', css: '#16a34a', rgb: [0.09, 0.64, 0.29] },
    { id: 'yellow', label: 'Yellow', css: '#eab308', rgb: [0.92, 0.7, 0.03] },
  ];

  function getTextColorMeta(colorId) {
    return TEXT_COLOR_OPTIONS.find((opt) => opt.id === colorId) || TEXT_COLOR_OPTIONS[0];
  }
  useEffect(() => {
    if (tool !== 'line') setLineDraft(null);
  }, [tool]);

  const [saving, setSaving] = useState(false);
  const [autoSaveMsg, setAutoSaveMsg] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const tabRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setPanelOpen(false), 150);
  }
  function cancelClose() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  }

  useEffect(() => {
    const tab = tabRef.current;
    if (!tab) return;
    const open = () => { cancelClose(); setPanelOpen(true); };
    const close = () => scheduleClose();
    tab.addEventListener('mouseenter', open);
    tab.addEventListener('mouseleave', close);
    return () => { tab.removeEventListener('mouseenter', open); tab.removeEventListener('mouseleave', close); };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const open = () => cancelClose();
    const close = () => scheduleClose();
    panel.addEventListener('mouseenter', open);
    panel.addEventListener('mouseleave', close);
    return () => { panel.removeEventListener('mouseenter', open); panel.removeEventListener('mouseleave', close); };
  }, [panelOpen]); // re-register when panel mounts/unmounts
  const autoSaveMsgTimerRef = useRef(null);

  const jumpToWrapper = (wrapper, mount) => {
    if (!wrapper || !mount) return;
    if (useWindowScrollRef.current) {
      const headerOffset = 88;
      const targetTop = Math.max(0, Math.round(wrapper.getBoundingClientRect().top + window.scrollY - headerOffset));
      window.scrollTo({ top: targetTop, behavior: 'auto' });
      requestAnimationFrame(() => {
        window.scrollTo({ top: targetTop, behavior: 'auto' });
      });
      return;
    }
    const targetTop = Math.max(0, wrapper.offsetTop - 8);
    mount.scrollTop = targetTop;
    requestAnimationFrame(() => {
      mount.scrollTop = targetTop;
    });
  };

  // PDF rendering effect
  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;

    setAnnotations([]);
    annotationsRef.current = [];
    setTextDraft(null);
    setLineDraft(null);
    setPageWrappers([]);

    const mount = containerRef.current;
    if (!mount) return undefined;

    const clearDom = () => {
      while (mount.firstChild) mount.removeChild(mount.firstChild);
    };

    const cleanupPdf = () => {
      if (pdfDocRef.current) { pdfDocRef.current.destroy().catch(() => {}); pdfDocRef.current = null; }
      if (loadingTaskRef.current) { loadingTaskRef.current.destroy(); loadingTaskRef.current = null; }
    };

    (async () => {
      setStatus('loading');
      setErrorText('');
      clearDom();
      cleanupPdf();

      const waitForWidth = () =>
        new Promise((resolve) => {
          const tryRead = () => {
            const w = mount.clientWidth || mount.parentElement?.clientWidth || window.innerWidth;
            if (w > 0) { resolve(w); return; }
            requestAnimationFrame(tryRead);
          };
          tryRead();
        });

      try {
        const buf = await data.arrayBuffer();
        if (cancelled || runId !== runIdRef.current) return;

        const pdfData = new Uint8Array(buf);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        loadingTaskRef.current = loadingTask;

        const pdfDoc = await loadingTask.promise;
        loadingTaskRef.current = null;
        pdfDocRef.current = pdfDoc;

        if (cancelled || runId !== runIdRef.current) { cleanupPdf(); return; }

        const numPages = pdfDoc.numPages;
        const containerWidth = await waitForWidth();
        if (cancelled || runId !== runIdRef.current) { cleanupPdf(); return; }

        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col items-center gap-4 py-4 px-2 w-full min-h-full';
        mount.appendChild(wrap);

        const newWrappers = [];

        for (let i = 1; i <= numPages; i++) {
          if (cancelled || runId !== runIdRef.current) break;

          const page = await pdfDoc.getPage(i);
          const w = mount.clientWidth || containerWidth;
          const canvas = await renderPageToCanvas(page, w);

          // position:relative wrapper so the SVG overlay (position:absolute) stays on top
          const pageWrapper = document.createElement('div');
          pageWrapper.style.position = 'relative';
          pageWrapper.style.display = 'inline-block';
          pageWrapper.appendChild(canvas);
          wrap.appendChild(pageWrapper);
          newWrappers.push(pageWrapper);
          // Publish wrappers incrementally so page tracking/restore can work
          // before the full document finishes rendering.
          setPageWrappers((prev) => [...prev, pageWrapper]);

          if (i === 1) setStatus('ready');

          await new Promise((r) => requestAnimationFrame(r));
        }

        if (cancelled || runId !== runIdRef.current) { clearDom(); cleanupPdf(); return; }

        setPageWrappers([...newWrappers]);
        setStatus('ready');
      } catch (err) {
        if (isExpectedPdfCancellation(err) || cancelled || runId !== runIdRef.current) {
          cleanupPdf();
          return;
        }
        console.error('PDF load error:', err);
        if (!cancelled && runId === runIdRef.current) {
          setStatus('error');
          setErrorText(err?.message || 'Could not load PDF');
        }
        cleanupPdf();
      }
    })();

    return () => {
      cancelled = true;
      clearDom();
      if (pdfDocRef.current) { pdfDocRef.current.destroy().catch(() => {}); pdfDocRef.current = null; }
      if (loadingTaskRef.current) { loadingTaskRef.current.destroy(); loadingTaskRef.current = null; }
    };
  }, [data]);

  useEffect(() => {
    didRestoreScrollRef.current = false;
    lastSavedPositionKeyRef.current = null;
    lastKnownPageRef.current = Number(initialReadingPosition?.pdfPage) || 1;
    lastUserScrollAtRef.current = 0;
  }, [data, itemId]);

  useEffect(() => {
    if (status !== 'ready' || didRestoreScrollRef.current) return;
    const mount = containerRef.current;
    if (!mount) return;
    useWindowScrollRef.current = !(mount.scrollHeight > mount.clientHeight + 2);
    const savedPage = Number(initialReadingPosition?.pdfPage);
    if (Number.isInteger(savedPage) && savedPage > 0) {
      if (!pageWrappers.length || savedPage > pageWrappers.length) {
        // Wait until page wrappers are available before attempting restore.
        return;
      }
      const wrapper = pageWrappers[savedPage - 1];
      if (wrapper) {
        jumpToWrapper(wrapper, mount);
        requestAnimationFrame(() => {
          jumpToWrapper(wrapper, mount);
          didRestoreScrollRef.current = true;
        });
        return;
      }
    }

    const savedScrollTop = Number(initialReadingPosition?.pdfScrollTop);
    if (Number.isFinite(savedScrollTop) && savedScrollTop >= 0) {
      mount.scrollTop = savedScrollTop;
      requestAnimationFrame(() => {
        mount.scrollTop = savedScrollTop;
        didRestoreScrollRef.current = true;
      });
      return;
    }

    if (!pageWrappers.length) return;
    didRestoreScrollRef.current = true;
  }, [status, initialReadingPosition, itemId, pageWrappers]);

  useEffect(() => {
    if (!onSaveReadingPosition || !storeName || !itemId) return undefined;
    const mount = containerRef.current;
    if (!mount) return undefined;
    let pollId = null;
    const getScrollTop = () => (useWindowScrollRef.current ? window.scrollY : mount.scrollTop);

    const getCurrentPage = () => {
      if (!pageWrappers.length) return null;
      if (useWindowScrollRef.current) {
        const headerOffset = 88;
        const readLine = window.scrollY + headerOffset + Math.max(120, (window.innerHeight - headerOffset) * 0.35);
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pageWrappers.length; i++) {
          const wrapper = pageWrappers[i];
          const r = wrapper.getBoundingClientRect();
          const top = r.top + window.scrollY;
          const bottom = top + Math.max(1, r.height);
          if (readLine >= top && readLine <= bottom) return i + 1;
          const dist = readLine < top ? (top - readLine) : (readLine - bottom);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestIndex = i;
          }
        }
        return bestIndex + 1;
      }

      const readLine = mount.scrollTop + Math.max(80, mount.clientHeight * 0.35);
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pageWrappers.length; i++) {
        const wrapper = pageWrappers[i];
        const top = wrapper.offsetTop;
        const bottom = top + Math.max(1, wrapper.clientHeight);
        if (readLine >= top && readLine <= bottom) return i + 1;
        const dist = readLine < top ? (top - readLine) : (readLine - bottom);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestIndex = i;
        }
      }
      return bestIndex + 1;
    };

    const saveNow = () => {
      // Important: avoid overwriting a previously saved page (often page 1)
      // before restore jump has completed.
      if (!didRestoreScrollRef.current && lastUserScrollAtRef.current === 0) {
        return;
      }
      useWindowScrollRef.current = !(mount.scrollHeight > mount.clientHeight + 2);
      const scrollTop = Math.max(0, Math.round(getScrollTop()));
      const detectedPage = getCurrentPage();
      const currentPage = Number.isInteger(detectedPage) && detectedPage > 0
        ? detectedPage
        : lastKnownPageRef.current;
      if (Number.isInteger(currentPage) && currentPage > 0) {
        lastKnownPageRef.current = currentPage;
      }

      // Avoid clobbering a valid saved page with page 1 during teardown/navigation
      // when layout snaps back to top without user scrolling.
      const recentUserScroll = Date.now() - lastUserScrollAtRef.current < 1500;
      if (
        !recentUserScroll &&
        currentPage === 1 &&
        lastKnownPageRef.current > 1 &&
        scrollTop <= 50
      ) {
        return;
      }

      const key = `${currentPage ?? ''}:${scrollTop}`;
      if (lastSavedPositionKeyRef.current === key) return;
      lastSavedPositionKeyRef.current = key;
      const payload = {
        kind: 'pdf',
        ...(currentPage ? { pdfPage: currentPage } : {}),
        // Keep for backward compatibility; may be 0 in some layouts.
        pdfScrollTop: scrollTop,
      };
      onSaveReadingPosition(itemId, storeName, payload).catch(() => {});
    };

    const onScroll = () => {
      lastUserScrollAtRef.current = Date.now();
      // If user actively scrolls before our restore flow finishes, treat that as
      // explicit navigation and allow position saves.
      if (!didRestoreScrollRef.current) {
        didRestoreScrollRef.current = true;
      }
      if (saveScrollDebounceRef.current) clearTimeout(saveScrollDebounceRef.current);
      saveScrollDebounceRef.current = setTimeout(saveNow, 300);
    };
    const onPageHide = () => saveNow();

    useWindowScrollRef.current = !(mount.scrollHeight > mount.clientHeight + 2);
    const scrollTarget = useWindowScrollRef.current ? window : mount;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    // Fallback polling keeps position synced even if some environments
    // suppress/merge scroll events during kinetic scrolling.
    pollId = window.setInterval(saveNow, 1200);

    // Persist once right after restore becomes active for this mount.
    const postRestoreSaveTimer = window.setTimeout(() => saveNow(), 400);

    return () => {
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
      if (saveScrollDebounceRef.current) {
        clearTimeout(saveScrollDebounceRef.current);
        saveScrollDebounceRef.current = null;
      }
      clearTimeout(postRestoreSaveTimer);
    };
  }, [itemId, onSaveReadingPosition, storeName, pageWrappers]);

  // Auto-save every 60 seconds
  useEffect(() => {
    if (readOnly || !onUpdateItem) return;
    const id = setInterval(() => {
      if (annotationsRef.current.length > 0) {
        performSave(annotationsRef.current, true);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [data, itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function performSave(currentAnnotations, isAuto = false) {
    if (!currentAnnotations.length || !onUpdateItem) return;
    setSaving(true);
    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const buf = await data.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buf);
      const pages = pdfDoc.getPages();

      for (const ann of currentAnnotations) {
        const page = pages[ann.pageIndex];
        if (!page) continue;
        const { width: pdfW, height: pdfH } = page.getSize();
        const wrapper = pageWrappers[ann.pageIndex];
        if (!wrapper) continue;
        const cssW = wrapper.clientWidth;
        const cssH = wrapper.clientHeight;
        const scaleX = pdfW / cssW;
        const scaleY = pdfH / cssH;
        if (ann.type === 'text') {
          const fontSize = Math.max(10, ann.fontSize || 14);
          const colorMeta = getTextColorMeta(ann.color);
          const lines = String(ann.text || '').split('\n');
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            page.drawText(lines[lineIdx], {
              x: ann.x * scaleX,
              y: pdfH - (ann.y + (lineIdx + 1) * fontSize) * scaleY,
              size: fontSize * scaleY,
              color: rgb(colorMeta.rgb[0], colorMeta.rgb[1], colorMeta.rgb[2]),
            });
          }
          continue;
        }
        if (ann.type === 'line') {
          page.drawLine({
            start: {
              x: ann.x1 * scaleX,
              y: pdfH - ann.y1 * scaleY,
            },
            end: {
              x: ann.x2 * scaleX,
              y: pdfH - ann.y2 * scaleY,
            },
            thickness: 2 * Math.max(scaleX, scaleY),
            color: rgb(0.85, 0.13, 0.13),
            opacity: 0.95,
          });
          continue;
        }
        page.drawRectangle({
          x: ann.x * scaleX,
          y: pdfH - (ann.y + ann.h) * scaleY,
          width: ann.w * scaleX,
          height: ann.h * scaleY,
          color: rgb(1, 1, 0),
          opacity: 0.35,
          borderWidth: 0,
        });
      }

      const bytes = await pdfDoc.save();
      const newBlob = new Blob([bytes], { type: 'application/pdf' });
      await onUpdateItem(itemId, newBlob, 'application/pdf');
      setAnnotations([]);
      annotationsRef.current = [];

      if (isAuto) {
        if (autoSaveMsgTimerRef.current) clearTimeout(autoSaveMsgTimerRef.current);
        setAutoSaveMsg('Auto-saved');
        autoSaveMsgTimerRef.current = setTimeout(() => setAutoSaveMsg(''), 2000);
      }
    } catch (err) {
      console.error('PDF save error:', err);
    } finally {
      setSaving(false);
    }
  }

  // --- SVG overlay per page (rendered via portal into each page wrapper DOM node) ---

  function getSvgCoords(e, svgEl) {
    const rect = svgEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e, pageIndex) {
    if (toolRef.current === 'none' || readOnly) return;
    e.preventDefault();
    const { x, y } = getSvgCoords(e, e.currentTarget);
    if (toolRef.current === 'text') {
      setTextDraft({ pageIndex, x, y, text: '' });
      return;
    }
    if (toolRef.current === 'line') {
      setTextDraft(null);
      if (!lineDraft || lineDraft.pageIndex !== pageIndex) {
        setLineDraft({ pageIndex, startX: x, startY: y, curX: x, curY: y });
        return;
      }
      const x1 = lineDraft.startX;
      const y1 = lineDraft.startY;
      const x2 = x;
      const y2 = y;
      if (Math.abs(x2 - x1) > 2 || Math.abs(y2 - y1) > 2) {
        setAnnotations((prev) => [...prev, { type: 'line', pageIndex, x1, y1, x2, y2 }]);
      }
      setLineDraft(null);
      return;
    }
    const d = { pageIndex, startX: x, startY: y, curX: x, curY: y };
    setDrag(d);
    dragRef.current = d;
  }

  function handleMouseMove(e, pageIndex) {
    const { x, y } = getSvgCoords(e, e.currentTarget);
    if (toolRef.current === 'line' && lineDraft && lineDraft.pageIndex === pageIndex) {
      setLineDraft((prev) => (prev ? { ...prev, curX: x, curY: y } : prev));
      return;
    }
    if (!dragRef.current || dragRef.current.pageIndex !== pageIndex) return;
    const d = { ...dragRef.current, curX: x, curY: y };
    setDrag(d);
    dragRef.current = d;
  }

  function handleMouseUp(e, pageIndex) {
    if (toolRef.current !== 'highlight') return;
    const d = dragRef.current;
    if (!d || d.pageIndex !== pageIndex) return;
    const { x, y } = getSvgCoords(e, e.currentTarget);
    const rx = Math.min(d.startX, x);
    const ry = Math.min(d.startY, y);
    const rw = Math.abs(x - d.startX);
    const rh = Math.abs(y - d.startY);
    if (rw > 4 && rh > 4) {
      setAnnotations((prev) => [...prev, { type: 'highlight', pageIndex, x: rx, y: ry, w: rw, h: rh }]);
    }
    setDrag(null);
    dragRef.current = null;
  }

  function handleMouseLeave() {
    // Cancel drag if mouse leaves SVG without releasing
    if (dragRef.current) {
      setDrag(null);
      dragRef.current = null;
    }
  }

  function removeAnnotation(globalIndex) {
    setAnnotations((prev) => prev.filter((_, i) => i !== globalIndex));
  }

  function commitTextDraft() {
    if (!textDraft) return;
    const text = String(textDraft.text || '').trim();
    if (!text) {
      setTextDraft(null);
      return;
    }
    setAnnotations((prev) => [
      ...prev,
      {
        type: 'text',
        pageIndex: textDraft.pageIndex,
        x: textDraft.x,
        y: textDraft.y,
        text,
        color: textColor,
        fontSize: textFontSize,
      },
    ]);
    setTextDraft(null);
  }

  function cancelTextDraft() {
    setTextDraft(null);
  }

  // Build portals: one SVG overlay per page wrapper
  const overlayPortals =
    !readOnly &&
    pageWrappers.map((wrapper, pageIndex) => {
      const pageAnnotations = annotations
        .map((ann, i) => ({ ann, i }))
        .filter(({ ann }) => ann.pageIndex === pageIndex);

      const isDragging = drag && drag.pageIndex === pageIndex;
      const dragRect = isDragging
        ? {
            x: Math.min(drag.startX, drag.curX),
            y: Math.min(drag.startY, drag.curY),
            w: Math.abs(drag.curX - drag.startX),
            h: Math.abs(drag.curY - drag.startY),
          }
        : null;

      const svgEl = React.createElement(
        'svg',
        {
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            cursor: tool !== 'none' ? 'crosshair' : 'default',
            // Allow pointer events only when tool is active or annotations exist
            pointerEvents: tool !== 'none' || pageAnnotations.length > 0 ? 'auto' : 'none',
          },
          onMouseDown: (e) => handleMouseDown(e, pageIndex),
          onMouseMove: (e) => handleMouseMove(e, pageIndex),
          onMouseUp: (e) => handleMouseUp(e, pageIndex),
          onMouseLeave: handleMouseLeave,
        },
        pageAnnotations.map(({ ann, i }) => {
          if (ann.type === 'text') {
            const lines = String(ann.text || '').split('\n');
            const fontSize = ann.fontSize || 14;
            const colorMeta = getTextColorMeta(ann.color);
            return React.createElement(
              'text',
              {
                key: i,
                x: ann.x,
                y: ann.y + fontSize,
                fill: colorMeta.css,
                fontSize,
                style: { cursor: 'pointer', userSelect: 'none' },
                onClick: (e) => { e.stopPropagation(); removeAnnotation(i); },
              },
              lines.map((line, idx) => React.createElement('tspan', {
                key: `${i}-${idx}`,
                x: ann.x,
                dy: idx === 0 ? 0 : fontSize,
              }, line))
            );
          }
          if (ann.type === 'line') {
            return React.createElement('line', {
              key: i,
              x1: ann.x1,
              y1: ann.y1,
              x2: ann.x2,
              y2: ann.y2,
              stroke: 'rgba(220, 38, 38, 0.95)',
              strokeWidth: 2,
              style: { cursor: 'pointer' },
              onClick: (e) => { e.stopPropagation(); removeAnnotation(i); },
            });
          }
          return React.createElement('rect', {
            key: i,
            x: ann.x,
            y: ann.y,
            width: ann.w,
            height: ann.h,
            fill: 'rgba(255, 230, 0, 0.35)',
            stroke: 'rgba(200, 160, 0, 0.7)',
            strokeWidth: 1,
            style: { cursor: 'pointer' },
            onClick: (e) => { e.stopPropagation(); removeAnnotation(i); },
          });
        }),
        dragRect &&
          React.createElement('rect', {
            key: 'drag',
            x: dragRect.x,
            y: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
            fill: 'rgba(255, 230, 0, 0.2)',
            stroke: 'rgba(200, 160, 0, 0.8)',
            strokeWidth: 1,
            strokeDasharray: '4 2',
            pointerEvents: 'none',
          })
      );
      const children = [svgEl];
      if (lineDraft && lineDraft.pageIndex === pageIndex) {
        children.push(
          React.createElement('svg', {
            key: 'line-draft',
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            },
          },
          React.createElement('line', {
            x1: lineDraft.startX,
            y1: lineDraft.startY,
            x2: lineDraft.curX,
            y2: lineDraft.curY,
            stroke: 'rgba(220, 38, 38, 0.75)',
            strokeWidth: 2,
            strokeDasharray: '6 3',
          }))
        );
      }
      if (textDraft && textDraft.pageIndex === pageIndex) {
        children.push(
          React.createElement(
            'div',
            {
              key: 'text-draft',
              style: {
                position: 'absolute',
                left: textDraft.x,
                top: textDraft.y,
                zIndex: 20,
                background: 'rgba(17,24,39,0.95)',
                border: '1px solid rgba(75,85,99,1)',
                borderRadius: 8,
                padding: 8,
                width: 220,
                boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
              },
              onMouseDown: (e) => e.stopPropagation(),
              onClick: (e) => e.stopPropagation(),
            },
            React.createElement('textarea', {
              autoFocus: true,
              rows: 3,
              value: textDraft.text,
              placeholder: 'Type annotation text',
              style: {
                width: '100%',
                resize: 'vertical',
                minHeight: 58,
                borderRadius: 6,
                border: '1px solid rgba(107,114,128,1)',
                padding: 6,
                fontSize: 13,
                background: 'rgba(255,255,255,0.95)',
                color: '#111827',
                outline: 'none',
              },
              onChange: (e) => setTextDraft((prev) => (prev ? { ...prev, text: e.target.value } : prev)),
              onKeyDown: (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  commitTextDraft();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelTextDraft();
                }
              },
            }),
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 } },
              React.createElement('span', { style: { color: '#d1d5db', fontSize: 12 } }, 'Color'),
              React.createElement(
                'select',
                {
                  value: textColor,
                  style: {
                    borderRadius: 6,
                    border: '1px solid rgba(107,114,128,1)',
                    padding: '4px 6px',
                    fontSize: 12,
                    background: 'rgba(255,255,255,0.95)',
                    color: '#111827',
                  },
                  onChange: (e) => setTextColor(e.target.value),
                },
                TEXT_COLOR_OPTIONS.map((opt) =>
                  React.createElement('option', { key: opt.id, value: opt.id }, opt.label)
                )
              )
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 } },
              React.createElement('span', { style: { color: '#d1d5db', fontSize: 12 } }, 'Size'),
              React.createElement(
                'select',
                {
                  value: String(textFontSize),
                  style: {
                    borderRadius: 6,
                    border: '1px solid rgba(107,114,128,1)',
                    padding: '4px 6px',
                    fontSize: 12,
                    background: 'rgba(255,255,255,0.95)',
                    color: '#111827',
                  },
                  onChange: (e) => setTextFontSize(Number(e.target.value)),
                },
                [12, 14, 16, 18, 20, 24, 28, 32].map((size) =>
                  React.createElement('option', { key: size, value: String(size) }, `${size}px`)
                )
              )
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 } },
              React.createElement('button', {
                style: {
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgba(75,85,99,1)',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                  fontSize: 12,
                },
                onClick: cancelTextDraft,
              }, 'Cancel'),
              React.createElement('button', {
                style: {
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgba(37,99,235,1)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                },
                onClick: commitTextDraft,
              }, 'Add Text'),
            ),
          )
        );
      }
      return ReactDOM.createPortal(
        React.createElement(React.Fragment, null, ...children),
        wrapper
      );
    });

  // Panel button helper
  function panelBtn(label, onClick, bg, color, disabled = false) {
    return React.createElement('button', {
      style: {
        padding: '5px 10px', borderRadius: 6, fontSize: 13, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
        background: bg, color, textAlign: 'left', whiteSpace: 'nowrap',
        opacity: disabled ? 0.6 : 1, width: '100%',
      },
      disabled,
      onClick,
    }, label);
  }

  return React.createElement(
    'div',
    { className: 'relative w-full h-full bg-gray-800 rounded-lg shadow-lg flex flex-col min-h-0' },

    // PDF scroll area
    status === 'loading' && React.createElement(
      'div',
      { className: 'absolute inset-0 z-10 flex items-center justify-center bg-gray-800/80 rounded-lg pointer-events-none' },
      React.createElement('p', { className: 'text-gray-200' }, 'Loading PDF…')
    ),
    status === 'error' && React.createElement(
      'div',
      { className: 'flex flex-1 items-center justify-center p-4 min-h-[120px]' },
      React.createElement('p', { className: 'text-red-300 text-center' }, errorText)
    ),
    React.createElement('div', {
      ref: containerRef,
      className: 'flex-1 min-h-0 overflow-auto rounded-lg bg-gray-900 ' + (status === 'error' ? 'hidden' : ''),
    }),

    // Tab strip — invisible hover zone on the left edge (native events)
    !readOnly && React.createElement('div', {
      ref: tabRef,
      style: {
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 30,
        cursor: 'default',
      },
    }),

    // Buttons panel — fixed, slides in from left edge on hover
    !readOnly && panelOpen && React.createElement(
      'div',
      {
        ref: panelRef,
        style: {
          position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)',
          zIndex: 9999, background: 'rgba(31,41,55,0.97)',
          borderRadius: '0 10px 10px 0', boxShadow: '4px 0 16px rgba(0,0,0,0.5)',
          padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160,
        },
      },
      panelBtn(
        tool === 'highlight' ? '✦ Highlight ON' : '✦ Highlight',
        () => setTool((t) => (t === 'highlight' ? 'none' : 'highlight')),
        tool === 'highlight' ? '#facc15' : 'rgba(75,85,99,1)',
        tool === 'highlight' ? '#111' : '#e5e7eb',
      ),
      panelBtn(
        tool === 'text' ? 'T Text ON' : 'T Text',
        () => setTool((t) => (t === 'text' ? 'none' : 'text')),
        tool === 'text' ? '#93c5fd' : 'rgba(75,85,99,1)',
        tool === 'text' ? '#111' : '#e5e7eb',
      ),
      panelBtn(
        tool === 'line' ? '/ Line ON' : '/ Line',
        () => setTool((t) => (t === 'line' ? 'none' : 'line')),
        tool === 'line' ? '#fca5a5' : 'rgba(75,85,99,1)',
        tool === 'line' ? '#111' : '#e5e7eb',
      ),
      tool === 'text' && React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            borderRadius: 8,
            background: 'rgba(17,24,39,0.85)',
          },
        },
        React.createElement('span', { style: { fontSize: 11, color: '#9ca3af' } }, 'Text settings'),
        React.createElement(
          'select',
          {
            value: textColor,
            style: {
              borderRadius: 6,
              border: '1px solid rgba(75,85,99,1)',
              padding: '4px 6px',
              fontSize: 12,
              background: 'rgba(255,255,255,0.95)',
              color: '#111827',
            },
            onChange: (e) => setTextColor(e.target.value),
          },
          TEXT_COLOR_OPTIONS.map((opt) =>
            React.createElement('option', { key: opt.id, value: opt.id }, opt.label)
          )
        ),
        React.createElement(
          'select',
          {
            value: String(textFontSize),
            style: {
              borderRadius: 6,
              border: '1px solid rgba(75,85,99,1)',
              padding: '4px 6px',
              fontSize: 12,
              background: 'rgba(255,255,255,0.95)',
              color: '#111827',
            },
            onChange: (e) => setTextFontSize(Number(e.target.value)),
          },
          [12, 14, 16, 18, 20, 24, 28, 32].map((size) =>
            React.createElement('option', { key: size, value: String(size) }, `Size ${size}`)
          )
        ),
      ),
      annotations.length > 0 && panelBtn(
        'Clear All',
        () => { setAnnotations([]); annotationsRef.current = []; setTextDraft(null); setLineDraft(null); },
        'rgba(75,85,99,1)', '#e5e7eb',
      ),
      annotations.length > 0 && panelBtn(
        saving ? 'Saving…' : 'Save',
        () => performSave(annotations),
        saving ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,1)', '#fff',
        saving,
      ),
      autoSaveMsg && React.createElement(
        'span',
        { style: { fontSize: 11, color: 'rgba(74,222,128,1)', paddingLeft: 2 } },
        autoSaveMsg,
      ),
    ),

    // SVG annotation overlays (portals into each page wrapper DOM node)
    overlayPortals,
  );
};
