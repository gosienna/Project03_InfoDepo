# Theming

InfoDepo ships a centralized, user-selectable color theme system. A user picks an accent color from the System Settings modal; the choice drives both the accent (buttons, links, icons) and the overall light-mode background/text palette across the whole app, including the standalone reader tabs.

## Mechanism

Tailwind is loaded via CDN (`index.html`, `reader.html`, `pdf-reader.html`) with no build-time config file, so a runtime-switchable color needs CSS custom properties rather than static Tailwind classes. Each page defines:

```html
<style>
  :root {
    --theme-50: 238 242 255; --theme-100: 224 231 255; /* … */
    --theme-950: 30 27 75; --theme-button-text: 238 242 255;
  }
</style>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: { extend: { colors: { theme: {
      50: 'rgb(var(--theme-50) / <alpha-value>)',
      /* … 100, 200, 300, 400, 500, 600, 700, 900, 950 */
    }, buttontext: 'rgb(var(--theme-button-text) / <alpha-value>)' } } }
  };
</script>
```

The `:root` block sets Indigo's own values so there's no flash of an unstyled theme before JS runs. Once `utils/theme.js` loads, it overwrites these variables with whichever theme is stored in `localStorage`. Because the Tailwind color is defined as `rgb(var(--theme-XXX) / <alpha-value>)`, ordinary Tailwind opacity modifiers keep working (`bg-theme-600/50`, `text-theme-900/70`, etc.) — the CSS variables hold space-separated `R G B` triplets, not hex, specifically so this syntax resolves correctly.

Every component then uses plain Tailwind classes — `bg-theme-500`, `text-theme-700`, `border-theme-300`, `text-buttontext` — exactly like any other Tailwind color family. No component ever branches on which theme is active; swapping themes is purely a matter of updating the CSS variables.

## `utils/theme.js`

```js
export const THEMES = {
  indigo: { label, swatchHex, buttonTextShade, shades: { 50, 100, 200, 300, 400, 500, 600, 700, 900, 950 } },
  // … 13 more
};

readTheme()       // reads THEME_STORAGE_KEY ('infodepo_theme') from localStorage, falls back to 'indigo'
writeTheme(id)     // persists the choice
applyTheme(id)     // sets --theme-{shade} for all 10 shades, plus --theme-button-text
```

`applyTheme(readTheme())` runs once at module top level, so importing `utils/theme.js` for its side effect (as `index.js`, `reader-entry.js`, and `pdf-reader-entry.js` all do, alongside the existing `mapGetOrInsertComputedPolyfill.js` import) is enough to apply the saved theme before the app renders. All three entry points share one origin, so the theme choice is automatically shared between the main app and any EPUB/PDF reader tabs — a tab just needs a fresh load to pick up a change made elsewhere.

### Adding a new theme

Add an entry to `THEMES` with:
- `label` — display name for the swatch tooltip
- `swatchHex` — the shade-500 color as a hex string, used for the swatch button's own background (the picker UI can't use Tailwind's `bg-theme-*` classes for itself, since it's choosing between themes)
- `shades` — RGB triplets (`"R G B"`, space-separated, no commas) for 50/100/200/300/400/500/600/700/900/950
- `buttonTextShade` — either `50` or `900`; whichever gives better contrast against the shade-500 button background (see Button text contrast below)

No other file needs to change — the swatch picker in `components/Library.js` renders `Object.entries(THEMES)` directly.

## The 14 themes

Indigo (default), Blue, Emerald, Rose, Amber, Violet, Purple, Fuchsia, Pink, Orange, Lime, Cyan, Sky — the first 13 use Tailwind's own published palette values (converted from hex to RGB) so they render pixel-identical to how the equivalent Tailwind color looks anywhere else on the web. **Claude** is the one custom/non-Tailwind theme, built from four brand colors the user supplied (white, cream, warm gray, terracotta); its darker shades (700/900/950) were derived rather than given, since none of the four source colors were dark enough for body text.

## Role table (light mode)

Every component maps a UI role to a fixed shade number, uniformly across all 14 themes:

| Role | Shade | Notes |
|---|---|---|
| Page background | 100 | |
| Panel / card / header / modal background | 50 | Lighter than page — panels read as "elevated" |
| Primary text | 900 | |
| Secondary text | 700 | |
| Muted / placeholder text | 500 | Same shade as the accent color, so even muted text carries a subtle brand tint — consistent across all themes since Tailwind's own shade-500 is already a saturated, identifiable color for every hue |
| Borders | 200 | |
| Button background | 500 | |
| Button text | `buttonTextShade` (50 or 900) | Adaptive per theme, see below |
| Button hover | 600 | Darkens on hover |
| Icons / links / focus rings | 600 | |
| Badges (status colors and theme-accent alike) | bg 100 / text 700 | Light-bg/dark-text, hue preserved (red stays "danger", teal stays "sync", etc.) |
| Disabled state | neutral `gray-200`/`gray-400` | Intentionally unthemed — disabled means "no active color" |

Solid, high-contrast buttons that use a **fixed, non-theme color** (e.g. a literal `bg-emerald-700 hover:bg-emerald-600 text-white` save button) are left alone — dark solid background + white text is safe regardless of which theme is active, since that pairing never changes. The rule above only applies to buttons using the *theme-driven* `bg-theme-500`/`600` colors, where the correct text color depends on which of the 14 themes is currently selected.

## Button text contrast

`bg-theme-500 text-white` was the original design, but WCAG contrast math showed white-on-shade-500 fails 4.5:1 for all 14 themes (as low as ~1.98:1 for Lime). Each theme instead ships a precomputed `buttonTextShade`:

- **50 (white text):** Indigo, Violet, Claude — these three have white winning the shade-500 contrast check, though only at the "large text" 3:1 threshold, not the stricter 4.5:1 for small body text (button labels are bold ≥14px, which qualifies as large text under WCAG).
- **900 (dark text):** all other themes — dark text against shade-500 clears 4.5:1 comfortably for most, with Purple as the tightest pass (~4.48:1).

`applyTheme()` writes the resolved color to `--theme-button-text`; components reference it via the `buttontext` Tailwind color (`text-buttontext`), never by branching in JS.

## Known exceptions (intentionally not theme-driven)

A few UI surfaces keep fixed colors on purpose, mirroring how professional tools and content-rendering surfaces conventionally behave regardless of the surrounding app's theme:

- **Elements floating over arbitrary photo/thumbnail content** — upload/delete icon overlays on `DataTile` cards, download-progress scrims, the "Channel"/"Desk"/file-type badges drawn on top of a thumbnail image. These need to stay legible against unpredictable image content, not the page background, so they keep a solid dark fill + white icon/text.
- **Code blocks and LaTeX rendering in `MarkdownEditor.js`** — the rendered preview's code/math styling keeps its own dark background, matching the common convention that syntax-highlighted content looks the same regardless of the page's light/dark mode.
- **The image-annotation canvas in `ImageEditor.js` and the PDF page viewport in `PdfViewer.js`** — the letterboxed area behind the actual image/PDF page stays dark, matching how professional image/PDF tools (Photoshop, Acrobat, Preview) keep a neutral dark canvas surround for color accuracy, independent of the app's own theme. The floating PDF annotation toolbar (tool buttons, color swatches, sliders) is part of this same self-contained dark surface.
- **The EPUB reading surface in `FoliateViewer.js`** (`bg-white`) — book content renders on its own page background, not the app's.
- **Desk canvas selection/connect-mode accents** (`#7c3aed`, a fixed violet) — the "this item is selected" outline and the "click here to complete a connection" indicator intentionally keep a fixed hue, distinct from the theme accent, so they remain visually unambiguous no matter which theme is active. (Connection *lines* themselves, by contrast, do use the theme: shade 700 for a normal line, 900 for a selected one — see `components/Desk.js`.)

## Files involved

- `utils/theme.js` — theme data, `readTheme`/`writeTheme`/`applyTheme`
- `index.html`, `reader.html`, `pdf-reader.html` — default `:root` CSS vars + `tailwind.config` extension (kept in sync by hand across all three)
- `index.js`, `reader-entry.js`, `pdf-reader-entry.js` — side-effect import of `utils/theme.js`
- `components/Library.js` — theme picker (swatch buttons) inside the System Settings modal
