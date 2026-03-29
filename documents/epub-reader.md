# EPUB Reader

## How EPUB Rendering Works

EPUB files are zip archives — each spine item is a self-contained XHTML file with its own CSS and assets. The renderer extracts and displays them one at a time.

```
book.epub (zip)
├── META-INF/container.xml      ← points to the OPF file
└── OEBPS/
    ├── content.opf             ← manifest (all files) + spine (reading order)
    ├── Text/chapter1.xhtml
    ├── Text/chapter2.xhtml
    ├── Styles/style.css
    └── Images/
```

The renderer parses the OPF spine to determine reading order, then loads each chapter on demand.

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

### Solution — No iframe at all
EPUB.js was removed. `reader.html` uses JSZip + Shadow DOM directly. No iframe is created at any point.

```
Before: React App → EpubViewer → <iframe sandbox> → EPUB.js (restricted)
After:  React App → window.open('/reader.html?id=X')
        reader.html → JSZip → Shadow DOM (no iframe, no sandbox)
```

## reader.html

Located at project root, served by Vite at `http://localhost:3001/reader.html`.

**Flow:**
1. Reads `?id=` from URL params
2. Opens the shared `InfoDepo` IndexedDB
3. Fetches the book Blob by ID
4. Parses `META-INF/container.xml` → OPF path → manifest + spine
5. Per chapter: extracts XHTML, rewrites asset URLs (`img src`, `link href`) to `blob:` URLs
6. Injects content into a Shadow DOM on `#viewer`
7. Prev/Next navigate by spine index; shows chapter `X / Y` counter

**CSS isolation:** `attachShadow({ mode: 'open' })` scopes all book styles inside the shadow root — book CSS cannot leak into page chrome, and Tailwind cannot bleed into book content.

## Shadow DOM Layout Containment

Book CSS sometimes uses `position: absolute` elements. Without a containing block inside the shadow root, these escape the shadow boundary and overlay page chrome (nav buttons, header), intercepting clicks.

Two rules are always injected ahead of book styles:

```css
/* Creates a containing block so book's absolutely-positioned elements
   (e.g. Kindle zoom overlays) cannot escape the shadow root */
.epub-content {
  position: relative;
  overflow: hidden;
}

/* Kindle-specific zoom widget — hidden, non-functional outside Kindle */
#PV, .PV-P { display: none !important; }
```

This was triggered by the One-Punch Man manga EPUB, which uses a `#PV` overlay (`position: absolute; width: 100%; height: 100%`) from Kindle Comic Creator. Without containment it covered the entire page and swallowed all click events.

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
| `unload` Permissions Policy violation | EPUB.js registers `unload` listeners, deprecated in Chrome 117+ | N/A — EPUB.js removed |
| Sandbox script blocking | `srcdoc` iframe lacks `allow-scripts` | Resolved — no iframe created; Shadow DOM used instead |
| Sandbox escape warning | `allow-scripts` + `allow-same-origin` together | Resolved — no iframe created |
| Absolutely-positioned book elements overlaying page chrome | Book CSS `position: absolute` escapes shadow root if no containing block | Resolved — `.epub-content { position: relative; overflow: hidden }` |
| Kindle zoom overlay (`#PV`) eating click events | KCC-generated EPUB includes full-page invisible overlay | Resolved — `#PV, .PV-P { display: none !important }` |
