# Google Drive integration

## Overview

Drive is used for:

1. owner backup and pull sync
2. item-level sharing authorization (ACL)
3. owner index discovery (`_infodepo_index.json`)
4. config storage (`config.json`)

There is no backend server; browser calls Drive APIs directly with OAuth tokens.

## Credentials and scopes

### Environment values

- `VITE_CLIENT_ID`: OAuth client ID
- `VITE_API_KEY`: Drive/YouTube API key
- `VITE_CONFIG`: Drive file ID for `config.json`
- `VITE_MASTER`: master account email

Drive folder ID is runtime state stored in localStorage (`infodepo_drive_folder_id`).

### Scopes used

- `OWNER_DRIVE_SCOPE`:
  - `https://www.googleapis.com/auth/drive.file`
  - `https://www.googleapis.com/auth/drive.readonly`
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
- `CONFIG_MANAGE_SCOPE`:
  - `https://www.googleapis.com/auth/drive`
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`

`CONFIG_MANAGE_SCOPE` is required for updating existing `config.json` files not created by the app.

## Backup and pull

### Backup (`backupAllToGDrive`)

- uploads new local content
- patches existing `driveId` files when local is newer
- persists `driveId` + Drive `modifiedTime`

### Pull (`syncDriveToLocal`)

- lists owner folder files
- downloads supported content
- upserts by `driveId`/name
- skips unchanged records based on timestamps

## Sharing-related Drive files

### `_infodepo_index.json`

- written by owner to linked folder
- includes item metadata and `sharedWith`
- consumed by peer/viewer sync for discovery

### `config.json`

- Drive file pointed to by `VITE_CONFIG`
- stores users map, roles, and optional `folderId`
- edited by master in `UserConfigModal`

## ACL synchronization

`applySharedWithToDriveFiles` reconciles file readers from `sharedWith`:

- grant readers newly added to `sharedWith`
- revoke readers removed from `sharedWith`
- can run targeted for a single item/channel

Library triggers this reconcile immediately after tile-level sharing edits.

## Viewer access flow

Viewer does not need own folder gate. They:

1. sign in and resolve role
2. read peer folder IDs from `config.json`
3. fetch peer `_infodepo_index.json`
4. download files shared with viewer
5. prune previously cached peer-owned files no longer shared

## Related files

- `utils/driveSync.js`
- `utils/libraryDriveSync.js`
- `utils/ownerIndex.js`
- `utils/peerSync.js`
- `utils/driveSharePermissions.js`
- `utils/driveScopes.js`
