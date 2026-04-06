
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ── helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

/** Render a single PDF.js page onto a fresh canvas. */
async function renderPageToCanvas(page, containerWidth) {
  const base = page.getViewport({ scale: 1 });
  const padding = 16;
  const cssW = Math.max(100, containerWidth - padding * 2);
  const userScale = cssW / base.width;
  const outputScale = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: userScale * outputScale });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / outputScale}px`;
  canvas.style.height = `${viewport.height / outputScale}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, userScale, outputScale };
}

// ── constants ────────────────────────────────────────────────────────────────

const TOOLS = {
  NONE: 'none',
  TEXT: 'text',
  DRAW: 'draw',
  HIGHLIGHT: 'highlight',
};

const DEFAULT_COLORS = {
  [TOOLS.TEXT]: '#000000',
  [TOOLS.DRAW]: '#ef4444',
  [TOOLS.HIGHLIGHT]: '#facc15',
};

// ── component ────────────────────────────────────────────────────────────────

export const PdfEditor = ({ video, onUpdateItem }) => {
  const containerRef = useRef(null);
  const pdfDocRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const runIdRef = useRef(0);

  // page metadata: { canvas, overlayCanvas, userScale, outputScale, pageIndex }
  const pagesRef = useRef([]);

  const [status, setStatus] = useState('loading');
  const [errorText, setErrorText] = useState('');
  const [activeTool, setActiveTool] = useState(TOOLS.NONE);
  const [toolColor, setToolColor] = useState(DEFAULT_COLORS[TOOLS.DRAW]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // annotations per page: { pageIndex → [ { type, ...data } ] }
  const annotationsRef = useRef({});

  // drawing state
  const drawingRef = useRef(false);
  const currentPathRef = useRef([]);
  const activePageRef = useRef(null);

  // ── load & render PDF ──────────────────────────────────────────────────────

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;
    const mount = containerRef.current;
    if (!mount) return undefined;

    const clearDom = () => { while (mount.firstChild) mount.removeChild(mount.firstChild); };
    const cleanupPdf = () => {
      if (pdfDocRef.current) { pdfDocRef.current.destroy().catch(() => {}); pdfDocRef.current = null; }
      if (loadingTaskRef.current) { loadingTaskRef.current.destroy(); loadingTaskRef.current = null; }
    };

    (async () => {
      setStatus('loading');
      setErrorText('');
      clearDom();
      cleanupPdf();
      pagesRef.current = [];
      annotationsRef.current = {};

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
        const buf = await video.data.arrayBuffer();
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

        for (let i = 1; i <= numPages; i++) {
          if (cancelled || runId !== runIdRef.current) break;

          const page = await pdfDoc.getPage(i);
          const w = mount.clientWidth || containerWidth;
          const { canvas, userScale, outputScale } = await renderPageToCanvas(page, w);

          // wrapper for stacking canvases
          const pageWrap = document.createElement('div');
          pageWrap.className = 'relative inline-block';
          pageWrap.style.width = canvas.style.width;
          pageWrap.style.height = canvas.style.height;

          canvas.className = 'rounded bg-white shadow-md';
          canvas.style.display = 'block';
          pageWrap.appendChild(canvas);

          // transparent overlay canvas for drawing
          const overlay = document.createElement('canvas');
          overlay.width = canvas.width;
          overlay.height = canvas.height;
          overlay.style.width = canvas.style.width;
          overlay.style.height = canvas.style.height;
          overlay.style.position = 'absolute';
          overlay.style.top = '0';
          overlay.style.left = '0';
          overlay.style.cursor = 'default';
          overlay.dataset.pageIndex = String(i - 1);
          pageWrap.appendChild(overlay);

          wrap.appendChild(pageWrap);

          pagesRef.current.push({ canvas, overlayCanvas: overlay, userScale, outputScale, pageIndex: i - 1 });

          if (i === 1) setStatus('ready');
          await new Promise((r) => requestAnimationFrame(r));
        }

        setStatus('ready');
      } catch (err) {
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
      cleanupPdf();
    };
  }, [video.data]);

  // ── redraw overlay for a page ──────────────────────────────────────────────

  const redrawOverlay = useCallback((pageIndex) => {
    const info = pagesRef.current[pageIndex];
    if (!info) return;
    const ctx = info.overlayCanvas.getContext('2d');
    const dpr = info.outputScale;
    ctx.clearRect(0, 0, info.overlayCanvas.width, info.overlayCanvas.height);

    const annotations = annotationsRef.current[pageIndex] || [];
    for (const ann of annotations) {
      if (ann.type === 'draw') {
        ctx.save();
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.strokeWidth * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let j = 0; j < ann.points.length; j++) {
          const p = ann.points[j];
          if (j === 0) ctx.moveTo(p.x * dpr, p.y * dpr);
          else ctx.lineTo(p.x * dpr, p.y * dpr);
        }
        ctx.stroke();
        ctx.restore();
      } else if (ann.type === 'highlight') {
        ctx.save();
        ctx.fillStyle = ann.color;
        ctx.globalAlpha = 0.35;
        const x = Math.min(ann.x1, ann.x2) * dpr;
        const y = Math.min(ann.y1, ann.y2) * dpr;
        const w = Math.abs(ann.x2 - ann.x1) * dpr;
        const h = Math.abs(ann.y2 - ann.y1) * dpr;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      } else if (ann.type === 'text') {
        ctx.save();
        ctx.fillStyle = ann.color;
        ctx.font = `${ann.fontSize * dpr}px Helvetica, Arial, sans-serif`;
        ctx.fillText(ann.text, ann.x * dpr, ann.y * dpr);
        ctx.restore();
      }
    }
  }, []);

  // ── overlay pointer events ─────────────────────────────────────────────────

  const getOverlayCoords = useCallback((e) => {
    const rect = e.target.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (activeTool === TOOLS.NONE) return;
    const pageIndex = Number(e.target.dataset.pageIndex);
    if (Number.isNaN(pageIndex)) return;
    const { x, y } = getOverlayCoords(e);
    activePageRef.current = pageIndex;

    if (activeTool === TOOLS.TEXT) {
      const text = prompt('Enter annotation text:');
      if (!text) return;
      if (!annotationsRef.current[pageIndex]) annotationsRef.current[pageIndex] = [];
      annotationsRef.current[pageIndex].push({ type: 'text', x, y, text, color: toolColor, fontSize });
      setIsDirty(true);
      redrawOverlay(pageIndex);
      return;
    }

    drawingRef.current = true;
    currentPathRef.current = [{ x, y }];
    e.target.setPointerCapture(e.pointerId);
  }, [activeTool, toolColor, fontSize, getOverlayCoords, redrawOverlay]);

  const handlePointerMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const { x, y } = getOverlayCoords(e);
    currentPathRef.current.push({ x, y });

    const pageIndex = activePageRef.current;
    const info = pagesRef.current[pageIndex];
    if (!info) return;
    const ctx = info.overlayCanvas.getContext('2d');
    const dpr = info.outputScale;

    if (activeTool === TOOLS.DRAW) {
      const pts = currentPathRef.current;
      if (pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = toolColor;
      ctx.lineWidth = strokeWidth * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(a.x * dpr, a.y * dpr);
      ctx.lineTo(b.x * dpr, b.y * dpr);
      ctx.stroke();
      ctx.restore();
    } else if (activeTool === TOOLS.HIGHLIGHT) {
      // redraw overlay + preview rect
      redrawOverlay(pageIndex);
      const start = currentPathRef.current[0];
      ctx.save();
      ctx.fillStyle = toolColor;
      ctx.globalAlpha = 0.35;
      const rx = Math.min(start.x, x) * dpr;
      const ry = Math.min(start.y, y) * dpr;
      const rw = Math.abs(x - start.x) * dpr;
      const rh = Math.abs(y - start.y) * dpr;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }, [activeTool, toolColor, strokeWidth, getOverlayCoords, redrawOverlay]);

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pageIndex = activePageRef.current;
    if (pageIndex == null) return;

    if (!annotationsRef.current[pageIndex]) annotationsRef.current[pageIndex] = [];

    if (activeTool === TOOLS.DRAW && currentPathRef.current.length > 1) {
      annotationsRef.current[pageIndex].push({
        type: 'draw',
        points: [...currentPathRef.current],
        color: toolColor,
        strokeWidth,
      });
      setIsDirty(true);
    } else if (activeTool === TOOLS.HIGHLIGHT && currentPathRef.current.length >= 2) {
      const start = currentPathRef.current[0];
      const end = currentPathRef.current[currentPathRef.current.length - 1];
      annotationsRef.current[pageIndex].push({
        type: 'highlight',
        x1: start.x, y1: start.y,
        x2: end.x, y2: end.y,
        color: toolColor,
      });
      setIsDirty(true);
    }

    currentPathRef.current = [];
    activePageRef.current = null;
    redrawOverlay(pageIndex);
  }, [activeTool, toolColor, strokeWidth, redrawOverlay]);

  // ── attach/detach pointer events on overlays ───────────────────────────────

  useEffect(() => {
    const overlays = pagesRef.current.map((p) => p.overlayCanvas);
    for (const ov of overlays) {
      ov.addEventListener('pointerdown', handlePointerDown);
      ov.addEventListener('pointermove', handlePointerMove);
      ov.addEventListener('pointerup', handlePointerUp);
      ov.style.cursor = activeTool === TOOLS.NONE ? 'default'
        : activeTool === TOOLS.TEXT ? 'text'
        : 'crosshair';
    }
    return () => {
      for (const ov of overlays) {
        ov.removeEventListener('pointerdown', handlePointerDown);
        ov.removeEventListener('pointermove', handlePointerMove);
        ov.removeEventListener('pointerup', handlePointerUp);
      }
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, activeTool, status]);

  // ── undo last annotation ───────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    // find last page with annotations and pop
    const entries = Object.entries(annotationsRef.current);
    let lastPage = -1;
    for (const [pi, arr] of entries) {
      if (arr.length > 0 && Number(pi) >= lastPage) lastPage = Number(pi);
    }
    if (lastPage < 0) return;
    annotationsRef.current[lastPage].pop();
    if (annotationsRef.current[lastPage].length === 0) {
      delete annotationsRef.current[lastPage];
    }
    redrawOverlay(lastPage);
    const anyLeft = Object.values(annotationsRef.current).some((a) => a.length > 0);
    setIsDirty(anyLeft);
  }, [redrawOverlay]);

  // ── save: bake annotations into PDF with pdf-lib ───────────────────────────

  const handleSave = useCallback(async () => {
    if (!onUpdateItem) return;
    setIsSaving(true);
    setSaveMsg(null);
    try {
      const srcBuf = await video.data.arrayBuffer();
      const pdfLibDoc = await PDFDocument.load(srcBuf);
      const helvetica = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfLibDoc.getPages();

      for (const [pageIdxStr, anns] of Object.entries(annotationsRef.current)) {
        const pi = Number(pageIdxStr);
        const libPage = pages[pi];
        if (!libPage) continue;
        const { width: pw, height: ph } = libPage.getSize();
        const info = pagesRef.current[pi];
        if (!info) continue;

        // CSS pixel dimensions of the rendered canvas
        const cssW = parseFloat(info.overlayCanvas.style.width);
        const cssH = parseFloat(info.overlayCanvas.style.height);
        const sx = pw / cssW;
        const sy = ph / cssH;

        for (const ann of anns) {
          if (ann.type === 'text') {
            const c = hexToRgb(ann.color);
            const pdfFontSize = ann.fontSize * sx;
            libPage.drawText(ann.text, {
              x: ann.x * sx,
              y: ph - ann.y * sy,
              size: pdfFontSize,
              font: helvetica,
              color: rgb(c.r, c.g, c.b),
            });
          } else if (ann.type === 'highlight') {
            const c = hexToRgb(ann.color);
            const x = Math.min(ann.x1, ann.x2) * sx;
            const y2 = Math.min(ann.y1, ann.y2) * sy;
            const w = Math.abs(ann.x2 - ann.x1) * sx;
            const h = Math.abs(ann.y2 - ann.y1) * sy;
            libPage.drawRectangle({
              x,
              y: ph - y2 - h,
              width: w,
              height: h,
              color: rgb(c.r, c.g, c.b),
              opacity: 0.35,
            });
          } else if (ann.type === 'draw') {
            const c = hexToRgb(ann.color);
            const pts = ann.points;
            for (let j = 1; j < pts.length; j++) {
              libPage.drawLine({
                start: { x: pts[j - 1].x * sx, y: ph - pts[j - 1].y * sy },
                end: { x: pts[j].x * sx, y: ph - pts[j].y * sy },
                thickness: ann.strokeWidth * sx,
                color: rgb(c.r, c.g, c.b),
              });
            }
          }
        }
      }

      const pdfBytes = await pdfLibDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      await onUpdateItem(video.id, blob, video.type);
      setIsDirty(false);
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error('PDF save error:', err);
      setSaveMsg('error');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [video, onUpdateItem]);

  // ── keyboard shortcut: Ctrl+S ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving) handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, isSaving, handleSave, handleUndo]);

  // ── select tool helper ─────────────────────────────────────────────────────

  const selectTool = useCallback((tool) => {
    setActiveTool((prev) => prev === tool ? TOOLS.NONE : tool);
    if (DEFAULT_COLORS[tool]) setToolColor(DEFAULT_COLORS[tool]);
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────

  const btn = (label, tool, extraCls) =>
    React.createElement('button', {
      className: `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
        activeTool === tool
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
      } ${extraCls || ''}`,
      onClick: () => selectTool(tool),
      title: label,
    }, label);

  return React.createElement(
    'div',
    { className: 'relative w-full h-full flex flex-col min-h-0' },

    // ── toolbar ──────────────────────────────────────────────────────────────
    React.createElement(
      'div',
      { className: 'flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 flex-wrap' },
      btn('Text', TOOLS.TEXT),
      btn('Draw', TOOLS.DRAW),
      btn('Highlight', TOOLS.HIGHLIGHT),

      // color picker
      React.createElement('input', {
        type: 'color',
        value: toolColor,
        onChange: (e) => setToolColor(e.target.value),
        className: 'w-7 h-7 rounded cursor-pointer border border-gray-600 bg-transparent',
        title: 'Color',
      }),

      // stroke width (draw mode)
      activeTool === TOOLS.DRAW && React.createElement(
        'label', { className: 'flex items-center gap-1 text-gray-300 text-xs' },
        'Width',
        React.createElement('input', {
          type: 'range', min: 1, max: 20, value: strokeWidth,
          onChange: (e) => setStrokeWidth(Number(e.target.value)),
          className: 'w-20',
        }),
        React.createElement('span', { className: 'w-4 text-center' }, strokeWidth),
      ),

      // font size (text mode)
      activeTool === TOOLS.TEXT && React.createElement(
        'label', { className: 'flex items-center gap-1 text-gray-300 text-xs' },
        'Size',
        React.createElement('input', {
          type: 'range', min: 8, max: 72, value: fontSize,
          onChange: (e) => setFontSize(Number(e.target.value)),
          className: 'w-20',
        }),
        React.createElement('span', { className: 'w-4 text-center' }, fontSize),
      ),

      // spacer
      React.createElement('div', { className: 'flex-1' }),

      // undo
      React.createElement('button', {
        className: 'px-3 py-1.5 rounded text-sm bg-gray-700 text-gray-200 hover:bg-gray-600',
        onClick: handleUndo,
        title: 'Undo (Ctrl+Z)',
      }, 'Undo'),

      // save
      React.createElement('button', {
        className: `px-3 py-1.5 rounded text-sm font-medium ${
          isDirty && !isSaving
            ? 'bg-green-600 text-white hover:bg-green-500'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`,
        onClick: handleSave,
        disabled: !isDirty || isSaving,
        title: 'Save (Ctrl+S)',
      }, isSaving ? 'Saving…' : 'Save'),

      // save feedback
      saveMsg === 'saved' && React.createElement('span', { className: 'text-green-400 text-xs' }, 'Saved!'),
      saveMsg === 'error' && React.createElement('span', { className: 'text-red-400 text-xs' }, 'Save failed'),
    ),

    // ── loading overlay ──────────────────────────────────────────────────────
    status === 'loading' &&
      React.createElement(
        'div',
        { className: 'absolute inset-0 z-10 flex items-center justify-center bg-gray-800/80 rounded-lg pointer-events-none' },
        React.createElement('p', { className: 'text-gray-200' }, 'Loading PDF…')
      ),

    // ── error ────────────────────────────────────────────────────────────────
    status === 'error' &&
      React.createElement(
        'div',
        { className: 'flex flex-1 items-center justify-center p-4 min-h-[120px]' },
        React.createElement('p', { className: 'text-red-300 text-center' }, errorText)
      ),

    // ── page container ───────────────────────────────────────────────────────
    React.createElement('div', {
      ref: containerRef,
      className: 'flex-1 w-full min-h-0 overflow-auto rounded-b-lg bg-gray-800 ' + (status === 'error' ? 'hidden' : ''),
    }),
  );
};
