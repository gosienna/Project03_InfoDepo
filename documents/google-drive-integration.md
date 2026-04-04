# Google Drive Integration

## Overview

InfoDepo uses Google Drive in two directions:

| Direction | Trigger | Scope |
|-----------|---------|-------|
| **Drive → Local** (Sync) | "Sync" button | Downloads new/updated files from a Drive folder into IndexedDB |
| **Local → Drive** (Backup) | Upload button per item, or "Backup All" | Uploads local IndexedDB content to Drive in original format |

Drive is a **backup and import source** — not a streaming cache. All content is always stored fully in IndexedDB (`data` blob always present). There are no metadata-only stubs or download-on-demand flows.

---

## Credentials

### OAuth 2.0 Client ID (`...apps.googleusercontent.com`)
- Identifies the **user** — triggers a Google login popup
- Required for any Drive read or write
- Stored in `.env` as `VITE_TEST_CLIENT_ID` (dev) or `localStorage` (prod)
- Safe to embed in browser code (public by design)

### API Key (`AIza...`)
- Identifies the **application** — no user login required
- Used only to **list folder contents** (public Drive API calls)
- Stored in `.env` as `VITE_TEST_API_KEY` (dev) or `localStorage` (prod)

### OAuth Scopes

| Scope | Used for |
|-------|----------|
| `drive.readonly` | Sync (downloading files from Drive) |
| `drive.file` | Backup/upload (creating files in Drive) |

### What NOT to use
- **OAuth Client Secret** (`GOCSPX-...`) — server-side only, never in browser code

---

## Credential Storage

| Mode | Source |
|------|--------|
| Dev (`import.meta.env.DEV`) | `.env` via `VITE_TEST_*` variables |
| Production | `localStorage` key `infodepo_drive_credentials`, entered via `DriveSettingsModal` |

`utils/driveCredentials.js` abstracts this — callers don't need to know the source.

---

## Drive → Local: Sync

### When
User clicks the **"Sync"** button in the Library toolbar (visible when credentials are set).

### What it syncs
Books and notes only (`application/epub+zip`, `application/pdf`, `text/plain`, `text/markdown`). YouTube items are local-only and excluded from sync.

### Algorithm (`utils/driveSync.js` → `syncDriveToLocal`)

```
1. GET drive/v3/files?q='FOLDER_ID' in parents
   → Filter to supported MIME types
   → Sort by modifiedTime descending (most recent first)

2. For each Drive file:
   a. Look up local record by driveId index
   b. Fallback: look up by filename (links locally-imported files to Drive)
   c. Compare modifiedTime — is Drive newer?
   d. If local exists + up to date → skip (backfill driveId if missing)
   e. If Drive is newer (or no local record) → download blob → upsertDriveBook(file, blob)

3. Return { added, updated, skipped }
```

### Result banner
```
Sync complete — 2 added, 1 updated, 5 unchanged
```

### `upsertDriveBook(driveFile, blob)`
- If record found by `driveId` or `name`: updates `driveId`, `modifiedTime`, `data`, `size`
- If no record: inserts new record with `driveId` set and full blob
- Always requires a blob — metadata-only stubs are not created

---

## Local → Drive: Backup

### Per-item upload
Each card in the library has an upload button (↑). Clicking it:
1. Acquires OAuth token with `drive.file` scope (cached per session)
2. POSTs a multipart upload to `drive/v3/files?uploadType=multipart`
3. On success: calls `setItemDriveId(id, idbStore, driveFileId)` to persist the Drive ID in IndexedDB
4. Card icon changes to green ✓

### Backup All
The **"Backup All"** button (`backupAllToGDrive` in `utils/driveSync.js`) uploads every item where `driveId === ''`:

```
For each item in (books + notes + videos) where driveId === '':
  Upload blob to Drive → get back Drive file ID
  Call setItemDriveId(id, idbStore, driveFileId)

For each image record where driveId === '':
  Upload image blob to Drive → get back Drive file ID
  Call setItemDriveId(id, 'images', driveFileId)

Return { backed: N, failed: M }
```

### Drive file format per content type

| Content type | Local filename | Drive filename | Drive MIME type |
|-------------|---------------|----------------|-----------------|
| EPUB | `MyBook.epub` | `MyBook.epub` | `application/epub+zip` |
| PDF | `Report.pdf` | `Report.pdf` | `application/pdf` |
| TXT | `Notes.txt` | `Notes.txt` | `text/plain` |
| Markdown | `My Note.md` | `My Note.md` | `text/markdown` |
| YouTube link | `Rick Roll.youtube` | `Rick Roll.json` | `application/json` |
| Image | `screenshot.png` | `screenshot.png` | `image/png` |

YouTube items are converted from `.youtube`/`application/x-youtube` to `.json`/`application/json` so Drive can display the content as readable text.

### `setItemDriveId(id, storeName, driveId)`
Updates the `driveId` field on any IndexedDB record after a successful upload. Works across all four stores by taking an explicit `storeName`.

---

## driveId Field

Every record in every store has a `driveId` field:

| Value | Meaning |
|-------|---------|
| `''` (empty string) | Not yet backed up to Drive |
| `'1BxiMVs0XRA...'` | Backed up; this string is the Drive file ID |

This field is the single source of truth for backup status. There is no `isMetadataOnly` flag or separate metadata-only path.

---

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable **Google Drive API** — APIs & Services → Library → search "Google Drive API"
4. Create **OAuth 2.0 Client ID**:
   - Type: Web application
   - Authorized JavaScript origins: `http://localhost:3001` (dev) and your production domain
5. Create **API Key**:
   - APIs & Services → Credentials → + Create Credentials → API key
   - Optionally restrict to Google Drive API
6. Fill credentials into `.env` (dev) or enter via the **Drive Folder** settings modal (prod)
7. Share the Drive folder as "Anyone with the link can view" for sync to work without user auth on listing

---

## Key Files

| File | Role |
|------|------|
| `utils/driveAuth.js` | `getOAuthToken(clientId, scope)` — reusable OAuth token helper |
| `utils/driveSync.js` | `syncDriveToLocal()` (Drive→Local) + `backupAllToGDrive()` (Local→Drive) |
| `utils/driveCredentials.js` | Abstracts `.env` vs `localStorage` credential source |
| `components/DevDriveBrowser.js` | Drive folder browser UI (dev + prod) |
| `components/DriveSettingsModal.js` | Production UI to enter/save Drive credentials |
| `components/Library.js` | Upload button handler (`handleUpload`), Backup All trigger, Sync trigger |

---

## Why Google Picker Was Removed

The original implementation used the Google Picker API widget. It was removed because:
- Required a separate Picker API to be enabled in Google Cloud
- API Key validation was stricter and harder to configure
- Error messages were unclear

Replaced with `DevDriveBrowser.js` — a custom folder browser using Drive API v3 directly.
