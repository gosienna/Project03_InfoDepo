import { useCallback, useEffect, useState } from 'react';
import { getDriveCredentials } from '../utils/driveCredentials.js';
import { getDriveFolderId } from '../utils/driveFolderStorage.js';
import { removeStoredAccessToken } from '../utils/driveOAuthStorage.js';
import {
  getDriveTokenForScope,
  resetDriveImplicitUploadToken,
} from '../utils/driveOAuthImplicitFlowToken.js';
import { OWNER_DRIVE_SCOPE } from '../utils/driveScopes.js';
import { CHANNEL_JSON_MARKER } from '../utils/driveSync.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';
import { cloneBlobForNetwork } from '../utils/cloneBlobForNetwork.js';

export const channelUploadKey = (ch) => `channel-${ch?.id}`;

/**
 * Google Drive multipart upload for library items and channel JSON, with per-tile status.
 * Used by Library and Desk so canvas tiles match grid upload behavior.
 */
export function useDriveTileUpload({ onSetDriveId, scheduleShareAclReconcile }) {
  const [uploadStatuses, setUploadStatuses] = useState({});
  const credentials = getDriveCredentials();
  const driveFolderId = getDriveFolderId();

  useEffect(() => {
    resetDriveImplicitUploadToken();
  }, [credentials.clientId]);

  const setStatus = useCallback((key, status) => {
    setUploadStatuses((prev) => ({ ...prev, [key]: status }));
  }, []);

  const handleUpload = useCallback(
    async (video) => {
      const uKey = libraryItemKey(video);
      setStatus(uKey, 'uploading');
      try {
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
        const isYoutube = video.type === 'application/x-youtube';
        const driveName = isYoutube ? video.name.replace(/\.youtube$/i, '.json') : video.name;
        const driveMime = isYoutube ? 'application/json' : (video.type || 'application/octet-stream');
        const metadata = {
          name: driveName,
          mimeType: driveMime,
          parents: [driveFolderId],
        };

        const fileBody = await cloneBlobForNetwork(video.data, driveMime);
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', fileBody);

        const existingDriveId = String(video.driveId || '').trim();
        const uploadUrl = existingDriveId
          ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingDriveId)}?uploadType=multipart&fields=id,name,modifiedTime`
          : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';
        const uploadMethod = existingDriveId ? 'PATCH' : 'POST';
        const res = await fetch(uploadUrl, {
          method: uploadMethod,
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || res.statusText);
        }

        const driveFile = await res.json();
        await onSetDriveId(video.id, video.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });
        setStatus(uKey, 'success');
        if (typeof scheduleShareAclReconcile === 'function') scheduleShareAclReconcile();
      } catch (err) {
        console.error('Upload failed:', err.message);
        resetDriveImplicitUploadToken();
        removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
        setStatus(uKey, 'error');
      }
    },
    [credentials.clientId, driveFolderId, onSetDriveId, scheduleShareAclReconcile, setStatus],
  );

  const handleChannelUpload = useCallback(
    async (ch) => {
      const uKey = channelUploadKey(ch);
      if (ch.driveId) {
        setStatus(uKey, 'success');
        return;
      }
      setStatus(uKey, 'uploading');
      try {
        const token = await getDriveTokenForScope(OWNER_DRIVE_SCOPE);
        const { id: _id, driveId: _d, ...rest } = ch;
        const payload = JSON.stringify({ _type: CHANNEL_JSON_MARKER, ...rest });
        const blob = new Blob([payload], { type: 'application/json' });
        const label = ch.name || ch.handle || ch.channelId;
        const safeName = String(label).replace(/[/\\?%*:|"<>]/g, '-');
        const driveName = `${safeName}.channel.json`;
        const metadata = {
          name: driveName,
          mimeType: 'application/json',
          parents: [driveFolderId],
        };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);

        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || res.statusText);
        }

        const driveFile = await res.json();
        await onSetDriveId(ch.id, 'channels', driveFile.id, { modifiedTime: driveFile.modifiedTime });
        setStatus(uKey, 'success');
        if (typeof scheduleShareAclReconcile === 'function') scheduleShareAclReconcile();
      } catch (err) {
        console.error('Channel upload failed:', err.message);
        resetDriveImplicitUploadToken();
        removeStoredAccessToken(credentials.clientId, OWNER_DRIVE_SCOPE);
        setStatus(uKey, 'error');
      }
    },
    [credentials.clientId, driveFolderId, onSetDriveId, scheduleShareAclReconcile, setStatus],
  );

  return {
    uploadStatuses,
    handleUpload,
    handleChannelUpload,
  };
}
