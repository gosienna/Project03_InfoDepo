import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two Vite transform plugins that fix "WebKitBlobResource error 1" on iOS/iPadOS Safari.
 *
 * ROOT CAUSE A — foliate-js/view.js: zip.js's BlobWriter produces streaming-backed
 * Blobs for each extracted EPUB resource. iOS WebKit can lose the backing data for
 * these blobs before the blob: URL is served to the iframe, causing the error.
 * Fix: materialise every extracted blob through arrayBuffer() so its data sits in
 * a plain RAM ArrayBuffer that WebKit can always read.
 *
 * ROOT CAUSE B — foliate-js/epub.js: EPUB chapters are re-serialised with
 * XMLSerializer (producing XML-syntax HTML) and stored as blob: URLs with MIME type
 * "application/xhtml+xml". iOS Safari silently refuses to load blob: URLs with that
 * content type in sandboxed iframes — this is the direct cause of the two UUID
 * errors the user sees. Fix: coerce the type to "text/html;charset=utf-8" in
 * createURL so WebKit treats the content as regular HTML5 (which its lenient parser
 * handles without issue).
 */

const foliateViewIosBlobFix = {
  name: 'foliate-view-ios-blob-fix',
  transform(code, id) {
    if (!id.includes('foliate-js/view.js') && !id.includes('foliate-js\\view.js')) return;
    const target = 'const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)))';
    if (!code.includes(target)) {
      console.warn('[foliate-view-ios-blob-fix] Target not found in foliate-js/view.js — patch not applied');
      return;
    }
    return {
      code: code.replace(
        target,
        `const loadBlob = load(async (entry, type) => {
    const blob = await entry.getData(new BlobWriter(type));
    const ab = await blob.arrayBuffer();
    return new Blob([ab], { type: type || 'application/octet-stream' });
})`,
      ),
      map: null,
    };
  },
};

const foliateEpubXhtmlFix = {
  name: 'foliate-epub-xhtml-fix',
  transform(code, id) {
    if (!id.includes('foliate-js/epub.js') && !id.includes('foliate-js\\epub.js')) return;
    const target = 'const url = URL.createObjectURL(new Blob([newData], { type: newType }))';
    if (!code.includes(target)) {
      console.warn('[foliate-epub-xhtml-fix] Target not found in foliate-js/epub.js — patch not applied');
      return;
    }
    return {
      code: code.replace(
        target,
        // iOS Safari will not load blob: URLs with application/xhtml+xml in iframes.
        // Serving the same content as text/html is safe: HTML5's parser handles
        // XMLSerializer output (valid XHTML-syntax) without issues.
        `const _iosBlobType = newType === 'application/xhtml+xml' ? 'text/html;charset=utf-8' : newType;
        const url = URL.createObjectURL(new Blob([newData], { type: _iosBlobType }))`,
      ),
      map: null,
    };
  },
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3001,
        host: '0.0.0.0',
        headers: {
          'Permissions-Policy': 'unload=*',
          'Cross-Origin-Opener-Policy': 'unsafe-none',
        },
      },
      plugins: [foliateViewIosBlobFix, foliateEpubXhtmlFix, react()],
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            reader: path.resolve(__dirname, 'reader.html'),
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
