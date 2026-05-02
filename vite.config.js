import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Patch foliate-js/view.js at build time: re-materialize every blob extracted
 * from the EPUB zip through an ArrayBuffer round-trip before handing it to
 * epub.js's URL.createObjectURL chain.
 *
 * zip.js's BlobWriter produces streaming-backed Blobs whose underlying data
 * can become inaccessible on iOS/iPadOS Safari (WebKitBlobResource error 1)
 * when those blobs are later accessed via blob: URLs inside iframes.
 * Forcing the data through arrayBuffer() produces a plain RAM-backed Blob that
 * WebKit can reliably serve from blob: URLs.
 */
const foliateIosBlobFix = {
  name: 'foliate-ios-blob-fix',
  transform(code, id) {
    if (!id.includes('foliate-js/view.js') && !id.includes('foliate-js\\view.js')) return;
    const target = 'const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)))';
    if (!code.includes(target)) {
      console.warn('[foliate-ios-blob-fix] Target line not found in foliate-js/view.js — patch not applied');
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
      plugins: [foliateIosBlobFix, react()],
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
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
