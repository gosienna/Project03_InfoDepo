# Development Setup

## Prerequisites

- Node.js (v18+ recommended for native `fetch` support)
- A Google Cloud project (for Drive integration in dev mode)
- Rust toolchain (`rustc`, `cargo`) + `wasm-pack` for web extraction WASM build

## Install & Run

```bash
npm install
npm run dev
# → http://localhost:3001
```

## Web Extractor (WASM) Setup

The web-to-Markdown extractor (`Explorer.js`) depends on the Rust WASM module in `public/wasm`.

1. Install Rust and wasm-pack (one-time):

```bash
# Install Rust toolchain (cargo + rustc)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install wasm-pack
cargo install wasm-pack
```

2. Build WASM artifacts:

```bash
wasm-pack build wasm-trafilatura --target web --out-dir ../public/wasm
```

3. Verify generated files:
- `public/wasm/trafilatura_wasm.js`
- `public/wasm/trafilatura_wasm_bg.wasm`

If these files are missing, extraction will fail with `/wasm/... 404` at runtime.

## Environment Variables

Create a `.env` file at the project root (already gitignored):

```
# Test data source
VITE_TEST_DRIVE_FOLDER_ID=<folder ID from Drive URL>

# Google credentials for dev Drive access
VITE_TEST_CLIENT_ID=<OAuth 2.0 Client ID>
VITE_TEST_API_KEY=<Google API Key — docs use secret… as placeholder for the real prefix>
```

These are only active in dev mode (`import.meta.env.DEV`). Vite strips them from production builds.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server on port 3001 |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test:epub` | Open EPUB viewer test in browser |
| `npm run test:epub:headless` | Run EPUB viewer test headless via Playwright |
| `npm run test:drive` | Validate Drive credentials and list test folder |

## Port Layout

| Port | What runs there |
|------|----------------|
| 3001 | Vite dev server — main app + all test pages |

`test:epub` and `test:epub:headless` reuse the same port 3001 dev server.

## Dev-Only Features

The yellow **"DEV: Test Folder"** button appears in the Library only when `import.meta.env.DEV === true`. It opens `DevDriveBrowser` which uses credentials from `.env` to browse the test Google Drive folder.

This button is automatically removed in production builds by Vite's tree-shaking.

## Vite Config Notes

- `Permissions-Policy: unload=*` header is set in `vite.config.js` to allow EPUB.js's `unload` event listeners (blocked by default in Chrome 117+)
- Google API scripts (`gsi/client`, `api.js`) are loaded in `index.html` via CDN — used by `DevDriveBrowser` for OAuth
- React, Tailwind, EPUB.js, JSZip are all CDN-loaded — not bundled by Vite

## Credential Validation

Run `npm run test:drive` to check your `.env` credentials before testing the Drive browser. It detects common mistakes such as putting an OAuth Client Secret (`GOCSPX-...`) in the API Key field.
