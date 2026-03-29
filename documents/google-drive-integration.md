# Google Drive Integration

## Overview

Google Drive access is **dev-only**. It is used to quickly load test books from a shared folder without manually uploading files each time. It does not appear in production builds.

## Credential Types

### OAuth 2.0 Client ID (`...apps.googleusercontent.com`)
- Identifies the **user** — triggers a Google login popup
- Required to access private Drive files
- Stored in `.env` as `VITE_TEST_CLIENT_ID`
- Safe to embed in browser code (the Client ID is public by design)

### API Key (`AIza...`)
- Identifies the **application** — no user login required
- Can only access **publicly shared** files/folders
- Stored in `.env` as `VITE_TEST_API_KEY`
- Used by `test-drive-connection.js` to list folder contents server-side

### What NOT to use
- **OAuth Client Secret** (`GOCSPX-...`) — this is server-side only, never put in browser code or `.env` for a client app

## .env Variables

```
VITE_TEST_DRIVE_FOLDER_ID=   # Google Drive folder ID (from the folder URL)
VITE_TEST_CLIENT_ID=         # OAuth 2.0 Client ID (numeric prefix required)
VITE_TEST_API_KEY=            # API Key starting with AIza...
```

All three are prefixed with `VITE_` so Vite exposes them to the browser via `import.meta.env`.

## DevDriveBrowser Component

Located at `components/DevDriveBrowser.js`. Only rendered when `import.meta.env.DEV === true`.

**Flow:**
```
"DEV: Test Folder" button clicked
  → DevDriveBrowser mounts
  → Reads credentials from import.meta.env
  → Google Identity Services OAuth popup
  → User grants drive.readonly access
  → Drive API v3: GET /files?q='FOLDER_ID' in parents
  → Lists EPUB/PDF/TXT files
  → User clicks "Import" on a file
  → Drive API v3: GET /files/FILE_ID?alt=media (with Bearer token)
  → Blob saved to IndexedDB via onAddBook()
```

**Supported MIME types:**
- `application/epub+zip`
- `application/pdf`
- `text/plain`

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable **Google Drive API** — APIs & Services → Library → search "Google Drive API"
4. Create **OAuth 2.0 Client ID**:
   - Type: Web application
   - Authorized JavaScript origins: `http://localhost:3001`
5. Create **API Key**:
   - APIs & Services → Credentials → + Create Credentials → API key
   - Optionally restrict to Google Drive API
6. Fill both into `.env`
7. Share the test Drive folder as "Anyone with the link can view"

## Why Google Picker Was Removed

The original implementation used the Google Picker API widget. It was removed because:
- Required a separate Picker API to be enabled in Google Cloud
- The API Key validation was stricter and harder to configure
- Error messages were unclear

Replaced with `DevDriveBrowser.js` — a custom folder browser using Drive API v3 directly, no Picker API needed.
