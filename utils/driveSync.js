import { fetchGoogleApisGet } from './googleApisFetch.js';
import {
  isPdfAnnotationSidecarFilename,
  pdfAnnotationSidecarFileName,
  serializePdfAnnotationSidecar,
  pdfAnnotationSidecarNeedsBackup,
} from './pdfAnnotationSidecar.js';
import { cloneBlobForNetwork } from './cloneBlobForNetwork.js';

function coverSidecarExt(mimeType) {
  const m = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return m[String(mimeType)] || 'bin';
}

export function coverSidecarFilename(itemName, coverMimeType) {
  return `${itemName}.infodepo-cover.${coverSidecarExt(coverMimeType)}`;
}

export function isCoverSidecarFilename(name) {
  return String(name).includes('.infodepo-cover.');
}

function coverSidecarParentName(sidecarName) {
  return String(sidecarName).replace(/\.infodepo-cover\.[^.]+$/, '');
}

export async function downloadDriveFileBlob(accessToken, driveId) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return r.ok ? r.blob() : null;
}

export const CHANNEL_JSON_MARKER = 'infodepo-channel';
export const DESK_JSON_MARKER = 'infodepo-desk';
const OWNER_INDEX_FILENAME = '_infodepo_index.json';

const SUPPORTED_MIME_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json', // YouTube URL entries + channel records backed up from the app
];

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
];

const ALL_SYNCABLE_MIME_TYPES = [...SUPPORTED_MIME_TYPES, ...IMAGE_MIME_TYPES];

/**
 * Syncs the Google Drive folder to local IndexedDB.
 * Downloads all supported files (documents + images) from Drive that are new or updated.
 * Images are matched to their parent notes by scanning markdown content for ![...](filename).
 * If allowedDriveIds is a Set, only those Drive file IDs are downloaded (shared read-only mode).
 * Returns: { added, updated, skipped }
 */
export async function syncDriveToLocal({
  accessToken,
  folderId,
  books,
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  getNotes,
  getChannelByDriveId,
  upsertDriveChannel,
  getDeskByDriveId,
  upsertDriveDesk,
  upsertDrivePdfAnnotation,
  upsertDriveCoverImage,
  onProgress,
  allowedDriveIds,
  lazyBooks = false,
  onBatchComplete,
}) {
  const progress = onProgress || (() => {});

  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  const listAllFolderFiles = async (id, throwOnError = false) => {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const f = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime)');
    const results = [];
    let pageToken = null;
    do {
      const pt = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const r = await fetchGoogleApisGet(
        `/drive/v3/files?q=${q}&fields=${f}&pageSize=1000${pt}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!r.ok) {
        if (throwOnError) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error?.message || r.statusText);
        }
        return results;
      }
      const data = await r.json();
      for (const file of data.files || []) {
        results.push({
          driveId: file.id, name: file.name, mimeType: file.mimeType,
          size: parseInt(file.size) || 0, modifiedTime: file.modifiedTime,
        });
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return results;
  };

  const listFolderContents = (id) => listAllFolderFiles(id, false);

  const downloadFile = (driveId) => downloadDriveFileBlob(accessToken, driveId);

  progress('Listing Drive files…');
  const allRawItems = await listAllFolderFiles(folderId, true);

  const driveFolders = allRawItems.filter(f => f.mimeType === FOLDER_MIME);
  const allDriveFiles = allRawItems.filter(f => ALL_SYNCABLE_MIME_TYPES.includes(f.mimeType));

  let contentFiles = allDriveFiles.filter(
    (f) => SUPPORTED_MIME_TYPES.includes(f.mimeType) && f.name !== OWNER_INDEX_FILENAME
  );
  let imageFiles = allDriveFiles.filter((f) => IMAGE_MIME_TYPES.includes(f.mimeType));

  if (allowedDriveIds && allowedDriveIds.size > 0) {
    contentFiles = contentFiles.filter((f) => allowedDriveIds.has(f.driveId));
    imageFiles   = imageFiles.filter((f) => allowedDriveIds.has(f.driveId));
  }

  contentFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  imageFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

  // Pre-scan Drive folders to identify note bundles (.md + assets inside a subfolder).
  // Done up-front so we know the global total before any downloads begin.
  const noteBundles = [];
  for (const folder of driveFolders) {
    const contents = await listFolderContents(folder.driveId);
    const mdFile = contents.find(
      f => /\.(md|markdown|mdown|mkd)$/i.test(f.name) && f.mimeType === 'text/markdown'
    );
    if (!mdFile) continue;
    const bundleImgs = contents.filter(f => IMAGE_MIME_TYPES.includes(f.mimeType));
    noteBundles.push({ folder, mdFile, bundleImgs });
  }

  // Cover sidecars are downloaded silently (they're UI metadata, not user content).
  const coverFiles      = imageFiles.filter(f => isCoverSidecarFilename(f.name));
  const userImageFiles  = imageFiles.filter(f => !isCoverSidecarFilename(f.name));

  const globalTotal = noteBundles.length + contentFiles.length + userImageFiles.length;
  let globalIdx = 0;
  let batchProcessed = 0;
  const batchTick = () => {
    batchProcessed++;
    if (onBatchComplete && batchProcessed % 20 === 0) onBatchComplete();
  };

  const counts = { added: 0, updated: 0, skipped: 0 };

  // Phase 1: note bundles
  for (const { folder, mdFile, bundleImgs } of noteBundles) {
    globalIdx++;
    progress(`${globalIdx} / ${globalTotal}`);

    let existing = await getBookByDriveId(mdFile.driveId);
    if (!existing) existing = await getBookByName(mdFile.name);

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(mdFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      counts.skipped++;
      batchTick(); continue;
    }

    const mdBlob = await downloadFile(mdFile.driveId);
    if (!mdBlob) { counts.skipped++; batchTick(); continue; }

    const assets = [];
    for (const imgFile of bundleImgs) {
      const blob = await downloadFile(imgFile.driveId);
      if (blob) assets.push({ name: imgFile.name, data: blob, type: imgFile.mimeType, driveId: imgFile.driveId });
    }

    const bundleFile = { ...mdFile, driveFolderId: folder.driveId };
    const action = await upsertDriveBook(bundleFile, mdBlob, assets);
    if (action === 'added') counts.added++;
    else counts.updated++;
    batchTick();
  }

  // Phase 2: content files (books, notes, channels, desks, YouTube)
  for (const driveFile of contentFiles) {
    globalIdx++;
    progress(`${globalIdx} / ${globalTotal}`);

    if (
      driveFile.mimeType === 'application/json' &&
      isPdfAnnotationSidecarFilename(driveFile.name) &&
      upsertDrivePdfAnnotation
    ) {
      try {
        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${driveFile.driveId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) {
          counts.skipped++;
          batchTick(); continue;
        }
        const text = await blobRes.text();
        const annAction = await upsertDrivePdfAnnotation(driveFile, text);
        if (annAction === 'added') counts.added++;
        else if (annAction === 'updated') counts.updated++;
        else counts.skipped++;
      } catch (e) {
        console.warn(`PDF annotation sidecar sync failed for ${driveFile.name}:`, e);
        counts.skipped++;
      }
      batchTick(); continue;
    }

    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      if (!existing.driveId) await upsertDriveBook(driveFile, existing.data);
      counts.skipped++;
      batchTick(); continue;
    }

    // For JSON files not in books/notes/videos, check channels/desks before downloading.
    if (!existing && driveFile.mimeType === 'application/json') {
      if (getChannelByDriveId) {
        const existingChannel = await getChannelByDriveId(driveFile.driveId);
        if (existingChannel) {
          const chNewer = !existingChannel.modifiedTime ||
            new Date(driveFile.modifiedTime) > new Date(existingChannel.modifiedTime);
          if (!chNewer) { counts.skipped++; batchTick(); continue; }
        }
      }
      if (getDeskByDriveId) {
        const existingDesk = await getDeskByDriveId(driveFile.driveId);
        if (existingDesk) {
          const deskNewer = !existingDesk.modifiedTime ||
            new Date(driveFile.modifiedTime) > new Date(existingDesk.modifiedTime);
          if (!deskNewer) { counts.skipped++; batchTick(); continue; }
        }
      }
    }

    // In lazy mode, skip blob download for binary files (EPUB, PDF).
    // JSON and markdown must always download to detect type.
    const isBookBinary = driveFile.mimeType !== 'application/json'
      && driveFile.mimeType !== 'text/markdown';
    if (lazyBooks && isBookBinary) {
      const action = await upsertDriveBook(driveFile, null);
      if (action === 'added') counts.added++;
      else if (action === 'updated') counts.updated++;
      else counts.skipped++;
      batchTick(); continue;
    }

    const blobRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFile.driveId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!blobRes.ok) {
      console.warn(`Failed to download ${driveFile.name}:`, blobRes.statusText);
      counts.skipped++;
      batchTick(); continue;
    }
    let blob = await blobRes.blob();
    let effectiveFile = driveFile;

    if (driveFile.mimeType === 'application/json') {
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        if (parsed._type === CHANNEL_JSON_MARKER && parsed.channelId && upsertDriveChannel) {
          const { _type, ...channelData } = parsed;
          const action = await upsertDriveChannel(driveFile, channelData);
          if (action === 'added') counts.added++;
          else if (action === 'updated') counts.updated++;
          else counts.skipped++;
          batchTick(); continue;
        } else if (parsed._type === DESK_JSON_MARKER && upsertDriveDesk) {
          const { _type, ...deskData } = parsed;
          const action = await upsertDriveDesk(driveFile, deskData);
          if (action === 'added') counts.added++;
          else if (action === 'updated') counts.updated++;
          else counts.skipped++;
          batchTick(); continue;
        } else if (parsed.url && /youtube\.com|youtu\.be/.test(parsed.url)) {
          const safeTitle = (parsed.title || 'YouTube Video').replace(/[/\\?%*:|"<>]/g, '-');
          effectiveFile = { ...driveFile, name: safeTitle + '.youtube', mimeType: 'application/x-youtube' };
          blob = new Blob([text], { type: 'application/x-youtube' });
        }
      } catch { /* not valid JSON — fall through to upsertDriveBook */ }
    }

    const action = await upsertDriveBook(effectiveFile, blob);
    if (action === 'added') counts.added++;
    else counts.updated++;
    batchTick();
  }

  // Phase 3: note-attached image files (counted in progress)
  if (userImageFiles.length > 0 && upsertDriveImage) {
    const noteIdByImageName = new Map();
    if (getNotes) {
      try {
        const notes = await getNotes();
        for (const note of notes) {
          if (!note.data) continue;
          const text = typeof note.data === 'string' ? note.data : await note.data.text();
          const imgRefs = text.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
          for (const ref of imgRefs) {
            const m = ref.match(/!\[[^\]]*\]\(([^)]+)\)/);
            if (m) noteIdByImageName.set(m[1], note.id);
          }
        }
      } catch (err) {
        console.warn('Failed to scan notes for image references:', err);
      }
    }

    for (const driveFile of userImageFiles) {
      globalIdx++;
      progress(`${globalIdx} / ${globalTotal}`);

      let existing = getImageByDriveId ? await getImageByDriveId(driveFile.driveId) : undefined;
      if (!existing && getImageByName) existing = await getImageByName(driveFile.name);

      const driveIsNewer = existing
        ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
        : true;

      if (existing && !driveIsNewer) { counts.skipped++; continue; }

      const blobRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFile.driveId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!blobRes.ok) {
        console.warn(`Failed to download image ${driveFile.name}:`, blobRes.statusText);
        counts.skipped++;
        continue;
      }
      const blob = await blobRes.blob();
      const noteId = noteIdByImageName.get(driveFile.name) || (existing ? existing.noteId : 0);
      const action = await upsertDriveImage(driveFile, blob, noteId);
      if (action === 'added') counts.added++;
      else if (action === 'updated') counts.updated++;
      else counts.skipped++;
    }
  }

  // Phase 4: cover sidecars — silent, not counted in progress
  if (coverFiles.length > 0 && upsertDriveCoverImage) {
    for (const driveFile of coverFiles) {
      const parentItemName = coverSidecarParentName(driveFile.name);
      const blobRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFile.driveId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (blobRes.ok) {
        const blob = await blobRes.blob();
        await upsertDriveCoverImage(
          { driveId: driveFile.driveId, parentItemName, mimeType: driveFile.mimeType, modifiedTime: driveFile.modifiedTime },
          blob
        ).catch(() => {});
      }
    }
  }

  return counts;
}

function timeMs(t) {
  if (t == null) return null;
  if (t instanceof Date) {
    const x = t.getTime();
    return Number.isNaN(x) ? null : x;
  }
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** True when local edits are newer than the last known Drive revision, or no Drive id yet. */
export function itemNeedsBackupUpload(item) {
  if (!item?.data) return false;
  const d = String(item.driveId || '').trim();
  if (!d) return true;
  const lm = timeMs(item.localModifiedAt);
  const mt = timeMs(item.modifiedTime);
  if (lm == null) return false;
  if (mt == null) return true;
  return lm > mt;
}

function noteBundleNeedsBackup(item) {
  if (!item?.data) return false;
  const isNote = item.type === 'text/markdown' || item.idbStore === 'notes';
  const hasAssets = isNote && Array.isArray(item.assets) && item.assets.length > 0;
  if (hasAssets) {
    const anyNew = item.assets.some((a) => a?.data && !String(a.driveId || '').trim());
    if (anyNew) return true;
  }
  return itemNeedsBackupUpload(item);
}

function deskNeedsBackupUpload(desk) {
  const d = String(desk?.driveId || '').trim();
  if (!d) return true;
  const lm = timeMs(desk.localModifiedAt);
  const mt = timeMs(desk.modifiedTime);
  if (lm == null) return false;
  if (mt == null) return true;
  return lm > mt;
}

function channelNeedsBackupUpload(ch) {
  const d = String(ch?.driveId || '').trim();
  if (!d) return true;
  const lm = timeMs(ch.localModifiedAt);
  const mt = timeMs(ch.modifiedTime);
  if (lm == null) return false;
  if (mt == null) return true;
  return lm > mt;
}

/**
 * Uploads local items to Google Drive (backup): new files, or PATCH when local edits are newer than Drive.
 * After each successful upload, calls onSetDriveId to persist the Drive file ID and optional sync times.
 *
 * @param {object} options
 * @param {string}   options.accessToken         - OAuth2 Bearer token with drive.file scope
 * @param {string}   options.folderId            - Target Drive folder ID
 * @param {Array}    options.items               - All library items (books, notes, videos); notes carry their assets inline
 * @param {Function} options.onSetDriveId        - (id, storeName, driveId, syncMeta?) => Promise; syncMeta = { modifiedTime?: string }
 * @param {Function} options.onSetNoteFolderData - (noteId, folderId, assetDriveIds) => Promise
 * @param {Function} options.onProgress          - (message: string) => void
 * @returns {Promise<{ backed: number, failed: number }>}
 */
export async function backupAllToGDrive({
  accessToken,
  folderId,
  items,
  channels,
  desks,
  onSetDriveId,
  onSetNoteFolderData,
  onProgress,
  getPdfAnnotationSidecar,
  setPdfAnnotationDriveSync,
  onSetCoverImageDriveSync,
}) {
  const progress = onProgress || (() => {});
  let backed = 0;
  let failed = 0;

  const postMultipart = async (blob, name, mimeType, targetParentId) => {
    const parentId = targetParentId || folderId;
    const mt = mimeType || 'application/octet-stream';
    const metadata = {
      name,
      mimeType: mt,
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const bodyBlob = await cloneBlobForNetwork(blob, mt);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', bodyBlob);
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
    return res.json();
  };

  const patchMultipart = async (fileId, blob, name, mimeType) => {
    const mt = mimeType || 'application/octet-stream';
    const metadata = {
      name,
      mimeType: mt,
    };
    const bodyBlob = await cloneBlobForNetwork(blob, mt);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', bodyBlob);
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error?.message || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };

  const createFolder = async (name, parentId) => {
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id,name',
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
    return res.json();
  };

  const itemsList = items || [];
  for (const item of itemsList) {
    if (!item.data || !noteBundleNeedsBackup(item)) continue;

    progress(`Backing up "${item.name}"...`);
    try {
      const isNote = item.type === 'text/markdown' || item.idbStore === 'notes';
      const hasAssets = isNote && Array.isArray(item.assets) && item.assets.length > 0;

      if (isNote && hasAssets) {
        const folderName = item.name.replace(/\.(md|markdown|mdown|mkd)$/i, '');
        const existingFolderId = String(item.driveFolderId || '').trim();
        const existingMdId = String(item.driveId || '').trim();

        if (!existingFolderId || !existingMdId) {
          const folder = await createFolder(folderName, folderId);
          const driveFile = await postMultipart(item.data, item.name, item.type, folder.id);
          await onSetDriveId(item.id, item.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });

          const assetDriveIds = [];
          for (const asset of item.assets) {
            if (asset.driveId) {
              assetDriveIds.push({ name: asset.name, driveId: asset.driveId });
              continue;
            }
            progress(`Backing up asset "${asset.name}" for "${item.name}"...`);
            const af = await postMultipart(asset.data, asset.name, asset.type, folder.id);
            assetDriveIds.push({ name: asset.name, driveId: af.id });
            backed++;
          }
          if (onSetNoteFolderData) await onSetNoteFolderData(item.id, folder.id, assetDriveIds);
          backed++;
        } else {
          let lastMdTime = item.modifiedTime;
          if (itemNeedsBackupUpload(item)) {
            const mdRes = await patchMultipart(existingMdId, item.data, item.name, item.type);
            lastMdTime = mdRes.modifiedTime;
            await onSetDriveId(item.id, item.idbStore, existingMdId, { modifiedTime: mdRes.modifiedTime });
            backed++;
          }
          const assetDriveIds = [];
          let anyNewAsset = false;
          for (const asset of item.assets) {
            if (String(asset.driveId || '').trim()) {
              assetDriveIds.push({ name: asset.name, driveId: asset.driveId });
              continue;
            }
            progress(`Backing up asset "${asset.name}" for "${item.name}"...`);
            const af = await postMultipart(asset.data, asset.name, asset.type, existingFolderId);
            assetDriveIds.push({ name: asset.name, driveId: af.id });
            anyNewAsset = true;
            backed++;
          }
          if (anyNewAsset && onSetNoteFolderData) {
            await onSetNoteFolderData(item.id, existingFolderId, assetDriveIds);
            const mdMeta = lastMdTime;
            await onSetDriveId(item.id, item.idbStore, existingMdId, {
              modifiedTime: typeof mdMeta === 'string' ? mdMeta : (mdMeta?.toISOString?.() || new Date().toISOString()),
            });
          }
        }
      } else {
        const isYoutube = item.type === 'application/x-youtube';
        const driveName = isYoutube ? item.name.replace(/\.youtube$/i, '.json') : item.name;
        const driveMime = isYoutube ? 'application/json' : item.type;
        const did = String(item.driveId || '').trim();
        let driveFile;
        if (did) {
          try {
            driveFile = await patchMultipart(did, item.data, driveName, driveMime);
          } catch (patchErr) {
            if (patchErr.status === 404 || patchErr.status === 403) {
              // 404: Drive file was deleted.
              // 403: file not owned by this OAuth client (e.g. imported from a share).
              // In both cases, upload a new file so the driveId is updated and the
              // item is no longer considered dirty on future syncs.
              console.warn(`PATCH ${patchErr.status} for "${item.name}", uploading as new file.`);
              driveFile = await postMultipart(item.data, driveName, driveMime);
            } else {
              throw patchErr;
            }
          }
        } else {
          driveFile = await postMultipart(item.data, driveName, driveMime);
        }
        await onSetDriveId(item.id, item.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });
        backed++;
        if (item.type === 'application/pdf' && setPdfAnnotationDriveSync) {
          try {
            await setPdfAnnotationDriveSync(item.id, item.idbStore, {
              pdfDriveId: driveFile.id,
            });
          } catch (e) {
            console.warn(`[backup] pdf sidecar pdfDriveId link failed for "${item.name}":`, e?.message);
          }
        }
      }
    } catch (err) {
      console.warn(`Backup failed for "${item.name}":`, err.message);
      failed++;
    }
  }

  // PDF annotation sidecars: upload when annotations changed even if PDF blob was not dirty.
  if (getPdfAnnotationSidecar && setPdfAnnotationDriveSync) {
    for (const item of itemsList) {
      if (item.type !== 'application/pdf' || !item.data) continue;
      const pdfDid = String(item.driveId || '').trim();
      if (!pdfDid) continue;
      let sc;
      try {
        sc = await getPdfAnnotationSidecar(item.id, item.idbStore);
      } catch {
        continue;
      }
      if (!sc || !pdfAnnotationSidecarNeedsBackup(sc)) continue;
      const annName = pdfAnnotationSidecarFileName(item.name);
      const payload = serializePdfAnnotationSidecar({
        pdfDriveId: pdfDid,
        itemId: item.id,
        idbStore: item.idbStore,
        annotations: sc.annotations || [],
      });
      const blob = new Blob([payload], { type: 'application/json' });
      const annDid = String(sc.annotationDriveId || '').trim();
      progress(`Backing up annotations for "${item.name}"...`);
      try {
        let annDriveFile;
        if (annDid) {
          try {
            annDriveFile = await patchMultipart(annDid, blob, annName, 'application/json');
          } catch (patchErr) {
            if (patchErr.status === 404 || patchErr.status === 403) {
              console.warn(`PATCH ${patchErr.status} for "${annName}", uploading as new file.`);
              annDriveFile = await postMultipart(blob, annName, 'application/json');
            } else {
              throw patchErr;
            }
          }
        } else {
          annDriveFile = await postMultipart(blob, annName, 'application/json');
        }
        await setPdfAnnotationDriveSync(item.id, item.idbStore, {
          annotationDriveId: annDriveFile.id,
          modifiedTime: annDriveFile.modifiedTime,
          pdfDriveId: pdfDid,
        });
        backed++;
      } catch (err) {
        console.warn(`Annotation backup failed for "${item.name}":`, err.message);
        failed++;
      }
    }
  }

  // Cover image sidecars: upload when cover blob exists but hasn't been uploaded yet.
  if (onSetCoverImageDriveSync) {
    for (const item of itemsList) {
      if (!item.data || !item.coverImage?.data || item.coverImageDriveId) continue;
      const coverBlob = item.coverImage.data;
      const coverMime = item.coverImage.type || 'image/jpeg';
      const sidecarName = coverSidecarFilename(item.name, coverMime);
      progress(`Backing up cover for "${item.name}"...`);
      try {
        const driveFile = await postMultipart(coverBlob, sidecarName, coverMime);
        await onSetCoverImageDriveSync(item.id, item.idbStore, {
          coverImageDriveId: driveFile.id,
          modifiedTime: driveFile.modifiedTime,
        });
        backed++;
      } catch (err) {
        console.warn(`Cover sidecar backup failed for "${item.name}":`, err.message);
        failed++;
      }
    }
  }

  for (const desk of desks || []) {
    if (!deskNeedsBackupUpload(desk)) continue;
    const label = desk.name || `desk-${desk.id}`;
    progress(`Backing up desk "${label}"...`);
    try {
      const { id, driveId: _d, ...rest } = desk;
      const payload = JSON.stringify({ _type: DESK_JSON_MARKER, ...rest });
      const blob = new Blob([payload], { type: 'application/json' });
      const safeName = String(label).replace(/[/\\?%*:|"<>]/g, '-');
      const fileName = `${safeName}.desk.json`;
      const did = String(desk.driveId || '').trim();
      let driveFile;
      if (did) {
        try {
          driveFile = await patchMultipart(did, blob, fileName, 'application/json');
        } catch (patchErr) {
          if (patchErr.status === 404 || patchErr.status === 403) {
            console.warn(`PATCH ${patchErr.status} for desk "${label}", uploading as new file.`);
            driveFile = await postMultipart(blob, fileName, 'application/json');
          } else {
            throw patchErr;
          }
        }
      } else {
        driveFile = await postMultipart(blob, fileName, 'application/json');
      }
      await onSetDriveId(id, 'desks', driveFile.id, { modifiedTime: driveFile.modifiedTime });
      backed++;
    } catch (err) {
      console.warn(`Backup failed for desk "${label}":`, err.message);
      failed++;
    }
  }

  for (const ch of channels || []) {
    if (!channelNeedsBackupUpload(ch)) continue;
    const label = ch.name || ch.handle || ch.channelId;
    progress(`Backing up channel "${label}"...`);
    try {
      const { id, driveId: _d, ...rest } = ch;
      const payload = JSON.stringify({ _type: CHANNEL_JSON_MARKER, ...rest });
      const blob = new Blob([payload], { type: 'application/json' });
      const safeName = String(label).replace(/[/\\?%*:|"<>]/g, '-');
      const fileName = `${safeName}.channel.json`;
      const did = String(ch.driveId || '').trim();
      let driveFile;
      if (did) {
        try {
          driveFile = await patchMultipart(did, blob, fileName, 'application/json');
        } catch (patchErr) {
          if (patchErr.status === 404 || patchErr.status === 403) {
            console.warn(`PATCH ${patchErr.status} for channel "${label}", uploading as new file.`);
            driveFile = await postMultipart(blob, fileName, 'application/json');
          } else {
            throw patchErr;
          }
        }
      } else {
        driveFile = await postMultipart(blob, fileName, 'application/json');
      }
      await onSetDriveId(id, 'channels', driveFile.id, { modifiedTime: driveFile.modifiedTime });
      backed++;
    } catch (err) {
      console.warn(`Backup failed for channel "${label}":`, err.message);
      failed++;
    }
  }

  return { backed, failed };
}
