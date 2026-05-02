# Ebook Reader (FoliateViewer)

## Supported Formats

EPUB, MOBI, AZW3 — all opened inline in the same tab via `FoliateViewer.js` using the [foliate-js](https://github.com/johnfactotum/foliate-js) library.

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

`Reader.js` dispatches by file extension/MIME type. For EPUB/MOBI/AZW/AZW3 it renders `FoliateViewer`:

```
Reader.js
  └── FoliateViewer.js
        └── <foliate-view> (custom element from foliate-js)
              ├── foliate-paginator  ← reflowable text EPUBs
              └── foliate-fxl        ← pre-paginated / fixed-layout EPUBs
```

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

## Sandbox warning

foliate-js deliberately uses `sandbox="allow-same-origin allow-scripts"` on its content iframes (needed for a WebKit event bug). The browser console warning about sandbox escape is expected and comes from foliate-js itself, not from application code.

## File Type Routing

`Reader.js` MIME-to-extension map:

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

`epub`, `mobi`, `azw`, `azw3` all route to `FoliateViewer`.

## Known Behaviour

| Issue | Cause | Status |
|-------|-------|--------|
| Sandbox escape warning in console | foliate-js uses `allow-scripts` + `allow-same-origin` for WebKit event bug | Expected — from foliate-js, not app code |
| AZW / KFX files with DRM | foliate-js throws `UnsupportedTypeError` | Handled — descriptive error shown |
| Blank white page between manga pages (paginator) | Paginator `next()` scrolls through trailing blank boundary column | Fixed — spread manga uses `view.goTo(index)` + scrolled flow |
| Fixed-layout manga not detected as fxl | KCC EPUBs use non-standard `<meta name="fixed-layout">` | Fixed — FoliateViewer detects via `sections.every(s => s.pageSpread != null)` |
| Kindle zoom overlay (`#PV`) in fxl iframes | KCC EPUB injects full-page tap-zone overlay | Fixed — `FXL_HIDE_CSS` injected on `load` event |
