import './utils/mapGetOrInsertComputedPolyfill.js';
import './utils/safariDeferredBlobUrlRevoke.js';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { peekInfoDepo } from './utils/peekInfoDepo.js';

function runPeekAndPrint() {
  return peekInfoDepo()
    .then((info) => {
      console.table(info.counts);
      console.info('[InfoDepo] origin (Application tab must be this exact origin):', info.origin);
      Object.entries(info.preview || {}).forEach(([store, rows]) => {
        if (!rows.length) return;
        console.info(`[InfoDepo] object store "${store}" — sample rows (open this store in DevTools):`);
        console.table(rows);
      });
      const rowTotal = Object.values(info.counts || {}).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0);
      if (rowTotal === 0) {
        console.warn(
          '[InfoDepo] All stores are empty here. If the library UI shows items, you may be on a different origin (e.g. 127.0.0.1 vs localhost) or a different profile.'
        );
      }
      return info;
    })
    .catch((err) => {
      console.error('[InfoDepo] peek failed (DB open error, wrong version, etc.):', err);
      throw err;
    });
}

window.peekInfoDepo = runPeekAndPrint;
window.infoDepoPeek = runPeekAndPrint;

if (import.meta.env.DEV && !sessionStorage.getItem('infodepo_peek_hint')) {
  sessionStorage.setItem('infodepo_peek_hint', '1');
  console.info(
    '[InfoDepo] Inspect DB: run await peekInfoDepo() — you must include () or the console only shows the function.'
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(App, null)
  )
);