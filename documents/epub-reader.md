# EPUB Reader

## How EPUB Rendering Works

EPUB files are zipped websites — each chapter is a self-contained HTML file with its own CSS and fonts. EPUB.js extracts and renders these chapters sequentially.

```
book.epub (zip)
├── chapter1.html
├── chapter2.html
├── styles.css
├── fonts/
└── images/
```

EPUB.js renders each chapter into a container element and manages pagination, navigation, and TOC.

## Why a Separate Page (reader.html)

The app originally rendered EPUB inside `EpubViewer.js` (a React component) using an `<iframe>`. This caused two browser security conflicts:

### Problem 1 — Sandbox script blocking
EPUB.js renders chapter HTML into `<iframe srcdoc="...">`. Chrome sandboxes `srcdoc` iframes, blocking script execution inside them:
```
about:srcdoc:1 Blocked script execution — 'allow-scripts' permission is not set
```
This broke Next/Prev page navigation.

### Problem 2 — Sandbox escape warning
Fixing Problem 1 required `allowScriptedContent: true`, which adds both `allow-scripts` and `allow-same-origin` to the iframe sandbox. Chrome warns that this combination allows the iframe to escape its own sandbox:
```
An iframe which has both allow-scripts and allow-same-origin can escape its sandboxing
```

### Solution — Open in a new tab
`reader.html` is a standalone page. EPUB.js renders directly into a `<div>` at the top-level document — no iframe nesting, no sandbox restrictions.

```
Before: React App → EpubViewer → <iframe sandbox> → EPUB.js (restricted)
After:  React App → window.open('/reader.html?id=X')
        reader.html → EPUB.js (full page context, no restrictions)
```

## reader.html

Located at project root, served by Vite at `http://localhost:3001/reader.html`.

**Flow:**
1. Reads `?id=` from URL params
2. Opens the shared `EBookReaderDB` IndexedDB
3. Fetches the book Blob by ID
4. Calls `ePub(arrayBuffer)` and `book.renderTo(viewer, { flow: 'paginated' })`
5. Enables Prev/Next buttons, shows page `X / Y` counter

## File Type Routing

`App.js` detects EPUB before passing to `Reader.js`:

```js
const isEpub = ext === 'epub' || mime === 'application/epub+zip';
if (isEpub) {
  window.open(`/reader.html?id=${book.id}`, '_blank');
  return;
}
// PDF and TXT fall through to inline viewers
```

`Reader.js` also has MIME type fallback for files imported from Google Drive that may lack a `.epub` extension:

```js
const MIME_TO_EXT = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};
const ext = getFileExtension(book.name) || MIME_TO_EXT[book.type] || '';
```

## Known Browser Behaviour

| Issue | Cause | Status |
|-------|-------|--------|
| `unload` Permissions Policy violation | EPUB.js registers `unload` listeners, deprecated in Chrome 117+ | Suppressed via `Permissions-Policy: unload=*` in `vite.config.js` |
| Sandbox script blocking | `srcdoc` iframe lacks `allow-scripts` | Resolved by moving to standalone `reader.html` |
| Sandbox escape warning | `allow-scripts` + `allow-same-origin` together | Resolved by moving to standalone `reader.html` |
