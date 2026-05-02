# Ebook Reader (FoliateViewer)

## Supported Formats

EPUB, MOBI, AZW3 — opened in a **dedicated tab** (`reader.html`) via `FoliateViewer.js` using the [foliate-js](https://github.com/johnfactotum/foliate-js) library.

```
book.epub / .mobi / .azw3
  └── foliate-js (view.js)
        ├── epub.js     ← parses OPF manifest + spine
        ├── mobi.js     ← decodes MOBI/AZW3
        ├── paginator.js  ← reflowable renderer (foliate-paginator)
        └── fixed-layout.js  ← fixed-layout renderer (foliate-fxl)
```

AZW (KFX format / DRM) cannot be opened — foliate-js throws `UnsupportedTypeError` and a descriptive message is shown.

## Architecture

Clicking an EPUB/MOBI/AZW/AZW3 tile in the library calls `window.open('/reader.html?id=X&store=Y', '_blank')` from `App.js`'s `openVideo()`. The new tab is a standalone React app (`reader-entry.js`) that reads the book from the same IndexedDB database and renders `FoliateViewer` directly.

```
App.js (openVideo)
  └── window.open('/reader.html?id=X&store=Y')
        └── reader-entry.js          ← standalone React entry
              └── FoliateViewer.js
                    └── <foliate-view> (custom element from foliate-js)
                          ├── foliate-paginator  ← reflowable text EPUBs
                          └── foliate-fxl        ← pre-paginated / fixed-layout EPUBs
```

**Why a separate tab?** foliate-js renders EPUB chapters in iframes nested inside a Shadow DOM inside the `<foliate-view>` custom element. On iOS/iPadOS Safari, blob: URLs passed across that nested context fail with `WebKitBlobResource error 1`. Opening in a top-level browsing context (a new tab) means foliate-js's iframes are direct children of the main frame — the same context that created the blob: URLs — which works on all iOS versions.

### `reader.html` / `reader-entry.js`

`reader.html` is a minimal standalone HTML page (Tailwind + React importmap, no Google scripts). `reader-entry.js` is its entry point:

1. Parses `?id=X&store=Y` from the URL (`id` is the IndexedDB integer key; `store` is `books`, `notes`, or `videos`).
2. Opens `InfoDepo` (v9) directly — no React hooks needed.
3. Reads the item record, sets `document.title` to the book name.
4. Renders `FoliateViewer` with `data`, `name`, `type`, `itemId`, `initialReadingPosition`, `onSaveReadingPosition`, and `storeName`.
5. `onSaveReadingPosition` writes back to IndexedDB directly (no main-app state to update; the library picks up the new position next time it loads).

Both `reader.html` and `reader-entry.js` are Vite build entry points (`rollupOptions.input.reader`).

## FoliateViewer Behaviour

### Opening a book

1. Creates a `<foliate-view>` element, appends it to the DOM.
2. Calls `view.open(file)` — foliate-js parses the file and mounts the appropriate renderer.
3. After open, inspects `view.isFixedLayout` and `view.book.sections` to determine the book type.
4. Sets up renderer attributes (`flow`, `max-column-count`) and styles.
5. Navigates to the saved CFI position, or calls `view.renderer.next()` to land on the first page.

### Reading position

Saved on the `relocate` event as `{ kind: 'foliate-cfi', cfi }` via `onSaveReadingPosition`. Restored via `view.goTo(cfi)` on next open.

### Layout toggle

For reflowable (text) EPUBs a **Scrolled / Paginated** toggle is shown. Default is scrolled. Fixed-layout books and manga lock to paginated (toggle hidden).

## Renderer selection and book type detection

foliate-js selects the renderer from `book.rendition.layout`:

| `rendition.layout` | Renderer |
|---|---|
| `'pre-paginated'` | `foliate-fxl` (fixed-layout) |
| anything else | `foliate-paginator` (reflowable) |

`rendition.layout` is read from EPUB3 `<meta property="rendition:layout">` or from `META-INF/com.apple.ibooks.display-options.xml`. KCC-generated manga EPUBs use the non-standard `<meta name="fixed-layout" content="true">` and lack a display-options file, so foliate-js does **not** detect them as fixed-layout — they use `foliate-paginator`.

`FoliateViewer` adds a second detection pass:

```js
const isSpreadManga = !fxl
    && sections.length > 0
    && sections.every(s => s.pageSpread != null);
```

If every spine item has a `page-spread-left` or `page-spread-right` property, the book is treated as a spread manga even though `view.isFixedLayout` is false.

## Blank page problem (paginator, paginated mode)

`foliate-paginator` adds two blank boundary columns around each section's content:

```
[blank col 0] [content col 1 … col N] [blank col N+1]
```

In a two-column spread viewport, each manga section (one image) occupies col 1 while col 2 is blank. Clicking Next scrolls to the blank boundary, causing "one white page between every page."

### Why `next()` shows the blank

`renderer.next()` → `#scrollToPage(page + 1)` — when `page+1` equals the trailing blank boundary, the blank is rendered before `#goTo(nextSection)` is called.

### Fix — direct section navigation for spread manga

For spread manga, `prevPage`/`nextPage` bypass `view.next()`/`view.prev()` entirely and call `view.goTo(sectionIndex ± 1)` instead. The paginator's `goTo` loads the new section directly through `#createView()` (old view removed → new iframe loaded → shown), never passing through the blank boundary column.

The current section index is tracked in `sectionIndexRef` from `view.renderer.addEventListener('relocate', ...)`.

Additionally, spread manga is kept in `flow='scrolled'` on the paginator — in scrolled mode the boundary columns do not exist at all, so even edge cases cannot produce a blank.

## Fixed-layout EPUBs (foliate-fxl)

When `view.isFixedLayout` is true, foliate-js uses `foliate-fxl`:

- `flow` attribute is ignored (only `zoom` is observed).
- `setStyles()` is not available.
- `next()`/`prev()` toggle between pages within a spread, then advance to the next spread.
- RTL manga: `next()` calls `#goLeft()` (right-to-left page order).

FoliateViewer sets `flowMode = 'paginated'` for fxl books, shows Prev/Next and edge-tap buttons, and hides the Scrolled/Paginated toggle.

A `load` event listener injects `FXL_HIDE_CSS` into each iframe as it loads, hiding Kindle overlay elements:

```css
#PV, .PV-P { display: none !important; }
```

## iOS/Safari compatibility patches

Three layers of patches address `WebKitBlobResource error 1` on iOS/iPadOS:

### 1. `utils/safariDeferredBlobUrlRevoke.js`

Loaded in both `index.js` and `reader-entry.js`. Patches `URL.revokeObjectURL` on Safari/iOS to defer actual revocation by 1500 ms. foliate-js revokes blob: URLs as soon as a spine section is unloaded; WebKit sometimes still has in-flight sub-resource loads (fonts, images) for that section in progress. Immediate revocation surfaces as `WebKitBlobResource error 1` during fast page turns.

### 2. Vite plugin — `foliateViewIosBlobFix` (`vite.config.js`)

Patches `makeZipLoader` in `foliate-js/view.js` at build time. The original code:

```js
const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)))
```

is replaced with a version that materialises every extracted zip entry through an `ArrayBuffer` round-trip before returning the Blob:

```js
const loadBlob = load(async (entry, type) => {
    const blob = await entry.getData(new BlobWriter(type));
    const ab = await blob.arrayBuffer();
    return new Blob([ab], { type: type || 'application/octet-stream' });
})
```

`BlobWriter` in zip.js creates streaming-backed Blobs. On iOS, WebKit can lose the backing data for these before the blob: URL is served to the iframe. Forcing the data through `arrayBuffer()` produces a plain RAM-backed Blob.

### 3. Vite plugin — `foliateEpubXhtmlFix` (`vite.config.js`)

Patches `createURL` in `foliate-js/epub.js` at build time. EPUB chapters are re-serialised by `XMLSerializer` (producing XML-syntax HTML) and stored with MIME type `application/xhtml+xml`. iOS Safari refuses to load blob: URLs with that content type in sandboxed iframes. The patch coerces the type:

```js
// original:
const url = URL.createObjectURL(new Blob([newData], { type: newType }))

// patched:
const _iosBlobType = newType === 'application/xhtml+xml' ? 'text/html;charset=utf-8' : newType;
const url = URL.createObjectURL(new Blob([newData], { type: _iosBlobType }))
```

HTML5's parser handles `XMLSerializer` output (valid XHTML-syntax) without issues, so changing the declared type is safe for all real-world EPUBs.

### 4. `utils/cloneBlobForNetwork.js`

Used when uploading to Drive (`Library.js`, `driveSync.js`). IndexedDB-backed Blobs fail with the same `WebKitBlobResource error 1` when read by `fetch`/`FormData` on iOS. Materialises the blob through `arrayBuffer()` before the upload.

### 5. `FoliateViewer.js` — `materializeAsFile`

Converts the `data` prop (an IndexedDB Blob) to an ArrayBuffer-backed `File` before passing it to `view.open()`. Prevents the outer EPUB zip file from hitting the same iOS blob eviction issue during zip parsing.

## Sandbox warning

foliate-js deliberately uses `sandbox="allow-same-origin allow-scripts"` on its content iframes (needed for a WebKit event bug). The browser console warning about sandbox escape is expected and comes from foliate-js itself, not from application code.

## File Type Routing

`App.js` `openVideo()` decides routing:

```
epub / mobi / azw / azw3  →  window.open('/reader.html?id=X&store=Y', '_blank')
pdf / txt / md / youtube   →  Reader.js inline (same-tab)
```

`Reader.js` MIME-to-extension map (used for inline viewers):

```js
const MIME_TO_EXT = {
  'application/epub+zip': 'epub',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw',
  'application/vnd.amazon.mobi8-ebook': 'azw3',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/x-youtube': 'youtube',
};
```

Even though `epub`, `mobi`, `azw`, `azw3` are still in `Reader.js`'s switch (for edge cases where the item is rendered inline, e.g. from a direct route), the primary path routes them through `reader.html`.

## Known Behaviour

| Issue | Cause | Status |
|-------|-------|--------|
| Sandbox escape warning in console | foliate-js uses `allow-scripts` + `allow-same-origin` for WebKit event bug | Expected — from foliate-js, not app code |
| AZW / KFX files with DRM | foliate-js throws `UnsupportedTypeError` | Handled — descriptive error shown |
| Blank white page between manga pages (paginator) | Paginator `next()` scrolls through trailing blank boundary column | Fixed — spread manga uses `view.goTo(index)` + scrolled flow |
| Fixed-layout manga not detected as fxl | KCC EPUBs use non-standard `<meta name="fixed-layout">` | Fixed — FoliateViewer detects via `sections.every(s => s.pageSpread != null)` |
| Kindle zoom overlay (`#PV`) in fxl iframes | KCC EPUB injects full-page tap-zone overlay | Fixed — `FXL_HIDE_CSS` injected on `load` event |
| `WebKitBlobResource error 1` on iOS/iPadOS | blob: URLs fail in nested Shadow DOM iframe context | Fixed — EPUB opens in dedicated tab (`reader.html`); see iOS patches above |
