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

## Drive Sync

### Overview

The **Sync** button reconciles the local IndexedDB library with the configured Drive folder. It is available in both dev and production modes whenever credentials are set.

### Storage Quota

The user sets a maximum storage limit (default **500 MB**) via the inline `Sync limit: [___] MB` input in the Library toolbar. The setting persists to `localStorage` under key `infodepo_sync_settings`.

Only **Drive-synced books** count against the quota. Locally-imported books (no `driveId`) are excluded.

### Sync Algorithm

```
Sync button clicked
  → getOAuthToken(clientId, drive.readonly)
  → Drive API v3: GET /files?q='FOLDER_ID' in parents&fields=id,name,mimeType,size,modifiedTime
  → Filter to supported MIME types
  → Sort by modifiedTime descending (most recent first)
  → Tally bytesUsed = Σ size of already-downloaded Drive-linked books
  → If bytesUsed > maxStorageBytes → show Over-limit modal (see below)
  → For each Drive file:
      - Look up local record by driveId, then by name (backfill fallback)
      - If local + up to date → skip
      - If fits quota → download blob → upsertDriveBook(file, blob)
      - Else → upsertDriveBook(file, null)  ← metadata-only stub
  → Show result banner: X added, Y updated, Z cloud-only, N unchanged
```

### Metadata-Only Stubs

Files that exceed the quota are stored as lightweight records with `isMetadataOnly: true` and `data: null`. They appear in the library grid with:
- Dashed border and dimmed background
- **☁ Cloud** badge (top-left)
- "Click to download & read" hint

Clicking a cloud-only book shows a **Download & Read** prompt. On confirmation:
1. `getOAuthToken()` acquires a fresh token
2. `GET /files/{driveId}?alt=media` downloads the blob
3. `markAsDownloaded(id, blob)` upgrades the IndexedDB record
4. Book opens normally

### Over-Limit Modal

If current Drive-synced storage already exceeds the quota when sync runs, the sync aborts early and shows a modal with three options:

| Button | Action |
|--------|--------|
| **Free up space** | Auto-selects oldest/largest Drive-synced books to cover the excess, converts them to metadata stubs via `evictToMetadata()`, then re-runs sync |
| **Increase limit** | Dismisses modal and focuses the storage limit input in the toolbar |
| **Cancel** | Aborts without changes |

### New Files

| File | Purpose |
|------|---------|
| `utils/driveAuth.js` | `getOAuthToken(clientId, scope)` — reusable OAuth token helper |
| `utils/driveSync.js` | `syncDriveToLocal()` + `selectEvictionCandidates()` — pure sync logic |
| `utils/syncSettings.js` | `getSyncSettings()` / `saveSyncSettings()` — localStorage persistence |

### IndexedDB Schema Changes (v3)

Three optional fields added to the `books` object store:

| Field | Type | Description |
|-------|------|-------------|
| `driveId` | `string` | Google Drive file ID; absent on locally-imported books |
| `driveModifiedTime` | `string` | ISO 8601 `modifiedTime` from Drive API |
| `isMetadataOnly` | `boolean` | `true` = no blob stored locally |

A `driveId` index enables O(1) lookup during sync. Existing records without these fields are unaffected.

---

## Why Google Picker Was Removed

The original implementation used the Google Picker API widget. It was removed because:
- Required a separate Picker API to be enabled in Google Cloud
- The API Key validation was stricter and harder to configure
- Error messages were unclear

Replaced with `DevDriveBrowser.js` — a custom folder browser using Drive API v3 directly, no Picker API needed.
