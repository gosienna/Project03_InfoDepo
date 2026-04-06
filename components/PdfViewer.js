
import React, { useEffect, useRef, useState } from 'react';
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

export const PdfViewer = ({ data }) => {
  const containerRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const pdfDocRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorText, setErrorText] = useState('');
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;

    const mount = containerRef.current;
    if (!mount) return undefined;

    const clearDom = () => {
      while (mount.firstChild) {
        mount.removeChild(mount.firstChild);
      }
    };

    const cleanupPdf = () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch(() => {});
        pdfDocRef.current = null;
      }
      if (loadingTaskRef.current) {
        loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
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
            if (w > 0) {
              resolve(w);
              return;
            }
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

        if (cancelled || runId !== runIdRef.current) {
          cleanupPdf();
          return;
        }

        const numPages = pdfDoc.numPages;
        const containerWidth = await waitForWidth();
        if (cancelled || runId !== runIdRef.current) {
          cleanupPdf();
          return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col items-center gap-4 py-4 px-2 w-full min-h-full';
        mount.appendChild(wrap);

        for (let i = 1; i <= numPages; i++) {
          if (cancelled || runId !== runIdRef.current) break;

          const page = await pdfDoc.getPage(i);
          const w = mount.clientWidth || containerWidth;
          const canvas = await renderPageToCanvas(page, w);
          wrap.appendChild(canvas);

          if (i === 1) {
            setStatus('ready');
          }

          await new Promise((r) => requestAnimationFrame(r));
        }

        if (cancelled || runId !== runIdRef.current) {
          clearDom();
          cleanupPdf();
          return;
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
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch(() => {});
        pdfDocRef.current = null;
      }
      if (loadingTaskRef.current) {
        loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
    };
  }, [data]);

  return React.createElement(
    'div',
    { className: 'relative w-full h-full bg-gray-800 rounded-lg shadow-lg flex flex-col min-h-0' },
    status === 'loading' &&
      React.createElement(
        'div',
        {
          className:
            'absolute inset-0 z-10 flex items-center justify-center bg-gray-800/80 rounded-lg pointer-events-none',
        },
        React.createElement('p', { className: 'text-gray-200' }, 'Loading PDF…')
      ),
    status === 'error' &&
      React.createElement(
        'div',
        { className: 'flex flex-1 items-center justify-center p-4 min-h-[120px]' },
        React.createElement('p', { className: 'text-red-300 text-center' }, errorText)
      ),
    React.createElement('div', {
      ref: containerRef,
      className:
        'flex-1 w-full min-h-0 overflow-auto rounded-lg bg-gray-900 ' +
        (status === 'error' ? 'hidden' : ''),
    })
  );
};
