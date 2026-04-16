import React, { useState, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// WASM loader — lazy singleton so init() only runs once per session.
//
// We inject a <script type="module"> at runtime so that Vite's import-analysis
// plugin never sees the path to the WASM module.  The browser fetches
// /wasm/trafilatura.js directly; we expose the module via a window global
// and signal readiness with a CustomEvent.
// ---------------------------------------------------------------------------
let _wasmModule = null;
let _wasmInitPromise = null;

function loadWasm() {
  if (_wasmModule) return Promise.resolve(_wasmModule);
  if (_wasmInitPromise) return _wasmInitPromise;

  _wasmInitPromise = new Promise((resolve, reject) => {
    // Already loaded from a previous attempt that set the global
    if (window.__trafilaturaWasm) {
      _wasmModule = window.__trafilaturaWasm;
      resolve(_wasmModule);
      return;
    }

    const onReady = () => {
      _wasmModule = window.__trafilaturaWasm;
      resolve(_wasmModule);
    };
    const onError = (e) => reject(new Error(e.detail?.message ||
      'WASM failed to load. Build it first:\n' +
      '  wasm-pack build wasm-trafilatura --target web --out-dir ../public/wasm'));

    window.addEventListener('trafilatura-ready', onReady, { once: true });
    window.addEventListener('trafilatura-error', onError, { once: true });

    // Inline module script — Vite never analyses textContent, so the
    // /wasm/ paths are resolved by the browser at runtime only.
    // We pass the .wasm URL explicitly to init() so it does not rely
    // on import.meta.url (which would be wrong inside an inline script).
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import init, * as wasm from '/wasm/trafilatura_wasm.js';
      init('/wasm/trafilatura_wasm_bg.wasm')
        .then(() => {
          window.__trafilaturaWasm = wasm;
          window.dispatchEvent(new CustomEvent('trafilatura-ready'));
        })
        .catch(e => {
          window.dispatchEvent(new CustomEvent('trafilatura-error', { detail: { message: e.message } }));
        });
    `;
    document.head.appendChild(script);
  });

  return _wasmInitPromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseHtmlTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function toAbsoluteImageUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function collectImageUrlsFromMarkdown(markdown, baseUrl) {
  const urls = new Set();

  // Match Markdown image syntax with optional title:
  // ![alt](url) and ![alt](url "title")
  const mdImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of markdown.matchAll(mdImageRegex)) {
    const absolute = toAbsoluteImageUrl(m[1], baseUrl);
    if (absolute) urls.add(absolute);
  }

  // Some extractors include raw HTML img tags in markdown output.
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  for (const m of markdown.matchAll(htmlImgRegex)) {
    const absolute = toAbsoluteImageUrl(m[1], baseUrl);
    if (absolute) urls.add(absolute);
  }

  return [...urls];
}

function fileNameFromPath(pathLike) {
  const clean = String(pathLike || '').trim().split('?')[0].split('#')[0];
  const slash = clean.lastIndexOf('/');
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}

function applyMarkdownEditorImageFormat(markdown, defaultWidthPx) {
  // Normalize to MarkdownEditor's expected syntax:
  //   ![alt|800](filename)
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_full, alt, src) => {
      const fileName = fileNameFromPath(src);
      const trimmedAlt = String(alt || '').trim();
      const hasSize = /\|\d+(?:x\d+)?$/.test(trimmedAlt);
      const displayAlt = trimmedAlt || fileName;
      const nextAlt = hasSize ? displayAlt : `${displayAlt}|${defaultWidthPx}`;
      return `![${nextAlt}](${fileName})`;
    }
  );
}

/** Ensures no two assets share the same filename (appends _2, _3, …). */
function dedupeFilename(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext  = dot >= 0 ? name.slice(dot)  : '';
  let i = 2;
  for (;;) {
    const candidate = `${base}_${i}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    i++;
  }
}

// ---------------------------------------------------------------------------
// Explorer component
// ---------------------------------------------------------------------------

export const Explorer = ({ addItem, addImage, onSaved }) => {
  const [urlInput,      setUrlInput]      = useState('');
  const [targetUrl,     setTargetUrl]     = useState('');   // canonical absolute URL for extraction
  const [iframeSrc,     setIframeSrc]     = useState('');   // direct URL loaded in iframe
  const [status,        setStatus]        = useState('idle');
  // 'idle' | 'ready' | 'extracting' | 'downloading' | 'done' | 'saving' | 'error'
  const [errorMsg,      setErrorMsg]      = useState('');
  const [markdown,      setMarkdown]      = useState('');
  const [title,         setTitle]         = useState('');
  const [panelOpen,     setPanelOpen]     = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [dlProgress,    setDlProgress]    = useState({ done: 0, total: 0 });

  const iframeRef = useRef(null);

  // ------------------------------------------------------------------
  // Go — point the iframe directly at the URL (no proxy, no blob URL)
  // ------------------------------------------------------------------
  const handleGo = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (url !== urlInput) setUrlInput(url);
    setTargetUrl(url);
    setErrorMsg('');
    // Route through the preview proxy so the iframe loads from our origin,
    // bypassing the target site's X-Frame-Options / CSP frame-ancestors.
    setIframeSrc(`/api/preview-url?u=${encodeURIComponent(url)}`);
    setStatus('ready');
  }, [urlInput]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleGo();
  }, [handleGo]);

  // ------------------------------------------------------------------
  // Extract — fetch HTML via Netlify proxy → WASM → download images
  // ------------------------------------------------------------------
  const handleExtract = useCallback(async () => {
    if (!targetUrl) return;
    setStatus('extracting');
    setErrorMsg('');
    setPanelOpen(false);

    try {
      // 1. Fetch HTML via Netlify proxy (CORS bypass)
      const proxyRes = await fetch(`/api/fetch-url?u=${encodeURIComponent(targetUrl)}`);
      if (!proxyRes.ok) {
        const err = await proxyRes.json().catch(() => ({}));
        throw new Error(err.error || `Proxy returned ${proxyRes.status}`);
      }
      const { html: rawHtml } = await proxyRes.json();

      // 2. Load WASM (cached after first call)
      let wasm;
      try {
        wasm = await loadWasm();
      } catch {
        throw new Error(
          'WASM module not found. Build it first:\n' +
          '  wasm-pack build wasm-trafilatura --target web --out-dir ../public/wasm'
        );
      }

      // 3. Run trafilatura extraction
      const rawMd = wasm.extract_markdown(rawHtml);
      if (!rawMd || !rawMd.trim()) throw new Error('Extraction returned no content for this page.');

      // 3. Collect unique image URLs (supports markdown + inline html img tags)
      const remoteUrls = collectImageUrlsFromMarkdown(rawMd, targetUrl);

      // 4. Download each image via the Netlify proxy
      setStatus('downloading');
      setDlProgress({ done: 0, total: remoteUrls.length });

      const usedNames   = new Set();
      const assets      = [];
      const urlToName   = {};

      for (let i = 0; i < remoteUrls.length; i++) {
        const imgUrl = remoteUrls[i];
        try {
          const res = await fetch(`/api/fetch-image?u=${encodeURIComponent(imgUrl)}`);
          if (res.ok) {
            const { base64, contentType, filename } = await res.json();
            const safeName = dedupeFilename(filename, usedNames);
            // Decode base64 → Uint8Array → Blob
            const byteChars = atob(base64);
            const byteArr   = new Uint8Array(byteChars.length);
            for (let j = 0; j < byteChars.length; j++) byteArr[j] = byteChars.charCodeAt(j);
            const blob = new Blob([byteArr], { type: contentType });
            assets.push({ filename: safeName, blob, mimeType: contentType });
            urlToName[imgUrl] = safeName;
          }
        } catch {
          // Skip images that fail — they'll remain as remote URLs in the markdown
        }
        setDlProgress({ done: i + 1, total: remoteUrls.length });
      }

      // 5. Rewrite remote image URLs → local filenames in the markdown
      let rewritten = rawMd;
      for (const [remoteUrl, localName] of Object.entries(urlToName)) {
        // Use split/join instead of regex to avoid special-char escaping issues
        rewritten = rewritten.split(remoteUrl).join(localName);
      }
      rewritten = applyMarkdownEditorImageFormat(rewritten, 800);

      // 6. Determine title from fetched HTML or first H1 in markdown
      const htmlTitle = parseHtmlTitle(rawHtml);
      const h1Match   = rawMd.match(/^#\s+(.+)$/m);
      const noteTitle = htmlTitle || (h1Match ? h1Match[1].trim() : 'Untitled');

      setPendingAssets(assets);
      setMarkdown(rewritten);
      setTitle(noteTitle);
      setPanelOpen(true);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message || 'Extraction failed');
      setStatus('error');
    }
  }, [targetUrl]);

  // ------------------------------------------------------------------
  // Save note + assets to IndexedDB
  // ------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!markdown) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const trimmedTitle = title.trim() || 'Untitled';
      const filename     = trimmedTitle.endsWith('.md') ? trimmedTitle : trimmedTitle + '.md';
      const mdBlob       = new Blob([markdown], { type: 'text/markdown' });

      const noteId = await addItem(filename, 'text/markdown', mdBlob);
      for (const { filename: assetName, blob, mimeType } of pendingAssets) {
        await addImage(noteId, assetName, blob, mimeType);
      }
      onSaved();
    } catch (e) {
      setErrorMsg(e.message || 'Save failed');
      setStatus('done'); // return to done state so user can retry
    }
  }, [markdown, title, pendingAssets, addItem, addImage, onSaved]);

  // ------------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------------
  const isBusy = status === 'extracting' || status === 'downloading' || status === 'saving';

  const extractBtnLabel =
    status === 'extracting'  ? 'Extracting…' :
    status === 'downloading' ? `Downloading images… (${dlProgress.done}/${dlProgress.total})` :
    'Extract to Markdown';

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return React.createElement(
    'div',
    { className: 'flex flex-col flex-1 min-h-0' },

    // ── URL bar ──────────────────────────────────────────────────────
    React.createElement(
      'div',
      { className: 'flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0' },

      // Back button
      React.createElement(
        'button',
        {
          onClick: () => iframeRef.current?.contentWindow?.history?.back(),
          disabled: !iframeSrc,
          className: 'w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 rounded hover:bg-gray-700 flex-shrink-0',
          title: 'Back',
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 19l-7-7 7-7' })
        )
      ),
      // Forward button
      React.createElement(
        'button',
        {
          onClick: () => iframeRef.current?.contentWindow?.history?.forward(),
          disabled: !iframeSrc,
          className: 'w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 rounded hover:bg-gray-700 flex-shrink-0',
          title: 'Forward',
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M9 5l7 7-7 7' })
        )
      ),
      // Reload button
      React.createElement(
        'button',
        {
          onClick: () => iframeRef.current?.contentWindow?.location?.reload(),
          disabled: !iframeSrc || isBusy,
          className: 'w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 rounded hover:bg-gray-700 flex-shrink-0',
          title: 'Reload',
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
        )
      ),

      // URL input
      React.createElement('input', {
        type: 'text',
        value: urlInput,
        onChange: (e) => setUrlInput(e.target.value),
        onKeyDown: handleKeyDown,
        placeholder: 'Enter a URL…',
        spellCheck: false,
        className: 'flex-1 bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 min-w-0',
      }),

      // Go button
      React.createElement(
        'button',
        {
          onClick: handleGo,
          disabled: isBusy || !urlInput.trim(),
          className: 'px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded flex-shrink-0',
        },
        'Go'
      ),

      // Extract button
      React.createElement(
        'button',
        {
          onClick: handleExtract,
          disabled: isBusy || !targetUrl,
          className: 'px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded flex-shrink-0 whitespace-nowrap',
        },
        extractBtnLabel
      )
    ),

    // ── Error banner ─────────────────────────────────────────────────
    errorMsg && React.createElement(
      'div',
      { className: 'px-4 py-2 bg-red-900/60 text-red-300 text-xs flex-shrink-0 whitespace-pre-line' },
      errorMsg
    ),

    // ── Main area: iframe + side panel ───────────────────────────────
    React.createElement(
      'div',
      { className: 'flex flex-1 min-h-0 overflow-hidden' },

      // Iframe pane
      React.createElement(
        'div',
        { className: `flex flex-col min-h-0 ${panelOpen ? 'w-[55%] flex-shrink-0' : 'flex-1'}` },
        iframeSrc
          ? React.createElement('iframe', {
              ref: iframeRef,
              src: iframeSrc,
              className: 'w-full flex-1 min-h-0 border-0',
              title: 'Web Preview',
            })
          : React.createElement(
              'div',
              { className: 'flex items-center justify-center flex-1 text-gray-500' },
              React.createElement(
                'div',
                { className: 'text-center space-y-3' },
                React.createElement(
                  'svg',
                  { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 mx-auto text-gray-600', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1, d: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' })
                ),
                React.createElement('p', { className: 'text-gray-400 text-sm' }, 'Enter a URL above and click Go'),
                React.createElement('p', { className: 'text-gray-600 text-xs' }, 'Then use Extract to Markdown to save the content')
              )
            )
      ),

      // Side panel (slides in after extraction)
      panelOpen && React.createElement(
        'div',
        { className: 'flex-1 flex flex-col border-l border-gray-700 bg-gray-900 min-h-0 overflow-hidden' },

        // Panel header
        React.createElement(
          'div',
          { className: 'flex items-center gap-2 px-3 py-2 border-b border-gray-700 flex-shrink-0 bg-gray-800' },
          React.createElement('input', {
            type: 'text',
            value: title,
            onChange: (e) => setTitle(e.target.value),
            className: 'flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 min-w-0',
            placeholder: 'Note title…',
          }),
          React.createElement(
            'button',
            {
              onClick: handleSave,
              disabled: isBusy || !markdown,
              className: 'px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded whitespace-nowrap flex-shrink-0',
            },
            status === 'saving' ? 'Saving…' : `Save as Note${pendingAssets.length ? ` (+${pendingAssets.length} img)` : ''}`
          ),
          React.createElement(
            'button',
            {
              onClick: () => setPanelOpen(false),
              className: 'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded hover:bg-gray-700 flex-shrink-0',
              title: 'Close panel',
            },
            React.createElement(
              'svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
            )
          )
        ),

        // Image download progress bar
        dlProgress.total > 0 && React.createElement(
          'div',
          { className: 'px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex-shrink-0' },
          React.createElement(
            'div',
            { className: 'flex items-center justify-between text-xs text-gray-400 mb-1' },
            React.createElement('span', null, `Images: ${dlProgress.done} / ${dlProgress.total}`),
            dlProgress.done === dlProgress.total
              ? React.createElement('span', { className: 'text-emerald-400' }, '✓ All downloaded locally')
              : null
          ),
          React.createElement(
            'div',
            { className: 'h-1 bg-gray-700 rounded-full overflow-hidden' },
            React.createElement('div', {
              className: 'h-full bg-emerald-500 transition-all duration-200',
              style: { width: `${dlProgress.total ? (dlProgress.done / dlProgress.total) * 100 : 0}%` },
            })
          )
        ),

        // Raw markdown preview
        React.createElement(
          'div',
          { className: 'flex-1 overflow-y-auto' },
          React.createElement(
            'pre',
            { className: 'p-4 text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed font-mono' },
            markdown
          )
        )
      )
    )
  );
};
