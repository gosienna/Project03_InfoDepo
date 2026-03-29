<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# InfoDepo

**A client-side e-book reader. Import EPUB, PDF, and TXT files — read them offline.**

</div>

---

## Features

- **Local file import** — upload EPUB, PDF, or TXT directly from your device
- **Offline reading** — books stored in IndexedDB, no server required
- **EPUB reader** — full pagination, TOC, and chapter navigation via EPUB.js
- **PDF & TXT viewers** — inline rendering
- **Dev mode Drive browser** — import books from a Google Drive folder during development

## Getting Started

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/gosienna/Project03_InfoDepo.git
cd Project03_InfoDepo
npm install
npm run dev
```

Open **http://localhost:3001** in your browser.

## Usage

| Action | How |
|--------|-----|
| Add a book | Click **"Add Book"** → select an EPUB, PDF, or TXT file |
| Read a book | Click any book card |
| Delete a book | Click the trash icon on a book card |
| Clear library | Click the trash icon in the toolbar |

EPUB files open in a dedicated reader tab with Prev / Next navigation and a page counter.

## Development

### Environment Variables

Create a `.env` file at the project root for dev-only Drive access:

```
VITE_TEST_DRIVE_FOLDER_ID=   # Google Drive folder ID
VITE_TEST_CLIENT_ID=         # OAuth 2.0 Client ID
VITE_TEST_API_KEY=            # Google API Key (AIza...)
```

The yellow **"DEV: Test Folder"** button appears only in dev mode and is stripped from production builds.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 3001 |
| `npm run build` | Production build |
| `npm run test:epub` | Open EPUB viewer test in browser |
| `npm run test:epub:headless` | Run EPUB test headless via Playwright |
| `npm run test:drive` | Validate Drive credentials and list test folder |

## Tech Stack

| | |
|---|---|
| Framework | React 18 (no JSX — `React.createElement`) |
| Build | Vite 6 |
| Styling | Tailwind CSS |
| Storage | IndexedDB (`InfoDepo` database) |
| EPUB | EPUB.js |
| Auth (dev) | Google OAuth 2.0 + Drive API v3 |
| Testing | Playwright |

## Project Structure

```
├── App.js                      # Root component
├── index.html                  # App shell + CDN imports
├── reader.html                 # Standalone EPUB reader (opens in new tab)
├── components/
│   ├── Library.js              # Book grid + file upload
│   ├── Reader.js               # Format dispatcher (PDF/TXT)
│   ├── EpubViewer.js           # Legacy inline viewer (unused for routing)
│   ├── PdfViewer.js
│   ├── TxtViewer.js
│   └── DevDriveBrowser.js      # Dev-only Drive folder browser
├── hooks/
│   └── useIndexedDB.js         # IndexedDB CRUD
├── scripts/
│   ├── test-drive-connection.js
│   └── test-epub-browser.js
├── documents/                  # Architecture and workflow docs
└── test_documents/             # Sample files for testing
```

## Docs

- [Architecture](documents/architecture.md)
- [Components & App Startup](documents/components.md)
- [EPUB Reader](documents/epub-reader.md)
- [Google Drive Integration](documents/google-drive-integration.md)
- [Testing](documents/testing.md)
- [Dev Setup](documents/dev-setup.md)
