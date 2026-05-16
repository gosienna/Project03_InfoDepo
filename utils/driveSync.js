import { fetchGoogleApisGet } from './googleApisFetch.js';
import {
  isPdfAnnotationSidecarFilename,
  pdfAnnotationSidecarFileName,
  serializePdfAnnotationSidecar,
  pdfAnnotationSidecarNeedsBackup,
} from './pdfAnnotationSidecar.js';
import { cloneBlobForNetwork } from './cloneBlobForNetwork.js';
import { isTempDriveId } from './driveRecordKey.js';

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
  channels,
  desks,
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

  // Build in-memory maps from the passed-in arrays so the hot loop avoids
  // per-file IDB roundtrips. IDB callbacks are kept as fallbacks for edge
  // cases (e.g. items added mid-sync, or callers that omit the arrays).
  const bookDriveMap    = new Map();
  const bookNameMap     = new Map();
  const channelDriveMap = new Map();
  const deskDriveMap    = new Map();
  const imageDriveMap   = new Map(); // driveId → { ...asset, noteId }
  const imageNameMap    = new Map(); // name    → { ...asset, noteId }

  for (const b of books || []) {
    const d = String(b.driveId || '').trim();
    const slim = { driveId: b.driveId, modifiedTime: b.modifiedTime, coverImageDriveId: b.coverImageDriveId };
    if (d) bookDriveMap.set(d, slim);
    if (b.name) bookNameMap.set(b.name, slim);
    for (const asset of b.assets || []) {
      const ad = String(asset.driveId || '').trim();
      const slimAsset = { driveId: asset.driveId, modifiedTime: asset.modifiedTime, noteDriveId: b.driveId };
      if (ad) imageDriveMap.set(ad, slimAsset);
      if (asset.name) imageNameMap.set(asset.name, slimAsset);
    }
  }
  for (const c of channels || []) {
    const d = String(c.driveId || '').trim();
    if (d) channelDriveMap.set(d, { driveId: c.driveId, modifiedTime: c.modifiedTime });
  }
  for (const dk of desks || []) {
    const d = String(dk.driveId || '').trim();
    if (d) deskDriveMap.set(d, { driveId: dk.driveId, modifiedTime: dk.modifiedTime });
  }

  const findBook = async (driveId, name) => {
    const d = String(driveId || '').trim();
    if (d && bookDriveMap.has(d)) return bookDriveMap.get(d);
    if (name && bookNameMap.has(name)) return bookNameMap.get(name);
    // Fallback to IDB (handles items not present in the snapshot)
    const byId = d && getBookByDriveId ? await getBookByDriveId(d) : undefined;
    if (byId) return byId;
    return name && getBookByName ? getBookByName(name) : undefined;
  };
  const findChannel = (driveId) => {
    const d = String(driveId || '').trim();
    if (d && channelDriveMap.has(d)) return Promise.resolve(channelDriveMap.get(d));
    return getChannelByDriveId ? getChannelByDriveId(d) : Promise.resolve(undefined);
  };
  const findDesk = (driveId) => {
    const d = String(driveId || '').trim();
    if (d && deskDriveMap.has(d)) return Promise.resolve(deskDriveMap.get(d));
    return getDeskByDriveId ? getDeskByDriveId(d) : Promise.resolve(undefined);
  };
  const findImage = async (driveId, name) => {
    const d = String(driveId || '').trim();
    if (d && imageDriveMap.has(d)) return imageDriveMap.get(d);
    if (name && imageNameMap.has(name)) return imageNameMap.get(name);
    const byId = d && getImageByDriveId ? await getImageByDriveId(d) : undefined;
    if (byId) return byId;
    return name && getImageByName ? getImageByName(name) : undefined;
  };

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
  // All subfolder listings run in parallel to avoid sequential API roundtrips.
  const folderScans = await Promise.all(
    driveFolders.map((folder) => listFolderContents(folder.driveId).then((contents) => ({ folder, contents })))
  );
  const noteBundles = [];
  for (const { folder, contents } of folderScans) {
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

    const existing = await findBook(mdFile.driveId, mdFile.name);

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

    const bookExisting = await findBook(driveFile.driveId, driveFile.name);
    let existing = bookExisting;

    // For JSON files not found in books/notes/videos, also search channels and desks.
    if (!existing && driveFile.mimeType === 'application/json') {
      existing = await findChannel(driveFile.driveId);
      if (!existing) existing = await findDesk(driveFile.driveId);
    }

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      // Only patch missing driveId for books/notes/videos — channels/desks manage their own driveId.
      if (bookExisting && !bookExisting.driveId) await upsertDriveBook(driveFile, null);
      counts.skipped++;
      batchTick(); continue;
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
    const noteDriveIdByImageName = new Map();
    if (getNotes) {
      try {
        const notes = await getNotes();
        for (const note of notes) {
          if (!note.data) continue;
          const text = typeof note.data === 'string' ? note.data : await note.data.text();
          const imgRefs = text.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
          for (const ref of imgRefs) {
            const m = ref.match(/!\[[^\]]*\]\(([^)]+)\)/);
            if (m) noteDriveIdByImageName.set(m[1], note.driveId);
          }
        }
      } catch (err) {
        console.warn('Failed to scan notes for image references:', err);
      }
    }

    for (const driveFile of userImageFiles) {
      globalIdx++;
      progress(`${globalIdx} / ${globalTotal}`);

      const existing = await findImage(driveFile.driveId, driveFile.name);

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
      const noteDriveId = noteDriveIdByImageName.get(driveFile.name) || (existing ? existing.noteDriveId : '');
      const action = await upsertDriveImage(driveFile, blob, noteDriveId);
      if (action === 'added') counts.added++;
      else if (action === 'updated') counts.updated++;
      else counts.skipped++;
    }
  }

  // Phase 4: cover sidecars — silent, not counted in progress
  if (coverFiles.length > 0 && upsertDriveCoverImage) {
    for (const driveFile of coverFiles) {
      const parentItemName = coverSidecarParentName(driveFile.name);

      const parentItem = bookNameMap.get(parentItemName) ?? (getBookByName ? await getBookByName(parentItemName) : undefined);
      if (parentItem?.coverImageDriveId === driveFile.driveId) continue;

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
async function drivePostMultipart(accessToken, blob, name, mimeType, parentId) {
  const mt = mimeType || 'application/octet-stream';
  const metadata = { name, mimeType: mt, ...(parentId ? { parents: [parentId] } : {}) };
  const bodyBlob = await cloneBlobForNetwork(blob, mt);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', bodyBlob);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
  );
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || res.statusText); }
  return res.json();
}

async function drivePatchMultipart(accessToken, fileId, blob, name, mimeType) {
  const mt = mimeType || 'application/octet-stream';
  const bodyBlob = await cloneBlobForNetwork(blob, mt);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, mimeType: mt })], { type: 'application/json' }));
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
}

/**
 * Pulls a single desk from Drive into IDB if the Drive copy is newer.
 * Used to gate the first desk display so a stale local copy cannot be
 * accidentally edited before the Drive version has been reconciled.
 * Returns 'updated' | 'skipped'.
 */
export async function syncSingleDeskFromDrive(desk, { accessToken, upsertDriveDesk }) {
  const driveId = String(desk?.driveId || '').trim();
  if (!driveId || !upsertDriveDesk) return 'skipped';

  const metaRes = await fetchGoogleApisGet(
    `/drive/v3/files/${driveId}?fields=id,name,mimeType,modifiedTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) return 'skipped';
  const fileMeta = await metaRes.json();

  const driveIsNewer = !desk.modifiedTime ||
    new Date(fileMeta.modifiedTime) > new Date(desk.modifiedTime);
  if (!driveIsNewer) return 'skipped';

  const blobRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!blobRes.ok) return 'skipped';

  const text = await blobRes.text();
  const parsed = JSON.parse(text);
  const { _type, ...deskData } = parsed;
  await upsertDriveDesk(
    { driveId, modifiedTime: fileMeta.modifiedTime, name: fileMeta.name },
    deskData
  );
  return 'updated';
}

/**
 * Uploads a single desk to Drive immediately. Used for per-edit auto-backup.
 * Skips the upload if the desk is not dirty (localModifiedAt ≤ modifiedTime).
 */
export async function backupSingleDesk(desk, { accessToken, folderId, onSetDriveId }) {
  if (!deskNeedsBackupUpload(desk)) return 'skipped';
  const label = desk.name || `desk-${desk.driveId}`;
  const { id: _legacyId, ...rest } = desk;
  const payload = JSON.stringify({ _type: DESK_JSON_MARKER, ...rest });
  const blob = new Blob([payload], { type: 'application/json' });
  const fileName = `${String(label).replace(/[/\\?%*:|"<>]/g, '-')}.desk.json`;
  const did = String(desk.driveId || '').trim();
  let driveFile;
  if (did) {
    try {
      driveFile = await drivePatchMultipart(accessToken, did, blob, fileName, 'application/json');
    } catch (patchErr) {
      if (patchErr.status === 404 || patchErr.status === 403) {
        driveFile = await drivePostMultipart(accessToken, blob, fileName, 'application/json', folderId);
      } else throw patchErr;
    }
  } else {
    driveFile = await drivePostMultipart(accessToken, blob, fileName, 'application/json', folderId);
  }
  await onSetDriveId(desk.driveId, 'desks', driveFile.id, { modifiedTime: driveFile.modifiedTime });
  return 'backed';
}

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

  const postMultipart = (blob, name, mimeType, targetParentId) =>
    drivePostMultipart(accessToken, blob, name, mimeType, targetParentId || folderId);

  const patchMultipart = (fileId, blob, name, mimeType) =>
    drivePatchMultipart(accessToken, fileId, blob, name, mimeType);

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
          await onSetDriveId(item.driveId, item.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });

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
          if (onSetNoteFolderData) await onSetNoteFolderData(item.driveId, folder.id, assetDriveIds);
          backed++;
        } else {
          let lastMdTime = item.modifiedTime;
          if (itemNeedsBackupUpload(item)) {
            const mdRes = await patchMultipart(existingMdId, item.data, item.name, item.type);
            lastMdTime = mdRes.modifiedTime;
            await onSetDriveId(item.driveId, item.idbStore, existingMdId, { modifiedTime: mdRes.modifiedTime });
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
            await onSetNoteFolderData(item.driveId, existingFolderId, assetDriveIds);
            const mdMeta = lastMdTime;
            await onSetDriveId(item.driveId, item.idbStore, existingMdId, {
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
        await onSetDriveId(item.driveId, item.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });
        backed++;
        if (item.type === 'application/pdf' && setPdfAnnotationDriveSync) {
          try {
            await setPdfAnnotationDriveSync(item.driveId, item.idbStore, {
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
        sc = await getPdfAnnotationSidecar(item.driveId, item.idbStore);
      } catch {
        continue;
      }
      if (!sc || !pdfAnnotationSidecarNeedsBackup(sc)) continue;
      const annName = pdfAnnotationSidecarFileName(item.name);
      const payload = serializePdfAnnotationSidecar({
        pdfDriveId: pdfDid,
        itemDriveId: item.driveId,
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
        await setPdfAnnotationDriveSync(item.driveId, item.idbStore, {
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
        await onSetCoverImageDriveSync(item.driveId, item.idbStore, {
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
    progress(`Backing up desk "${desk.name || `desk-${desk.driveId}`}"...`);
    try {
      await backupSingleDesk(desk, { accessToken, folderId, onSetDriveId });
      backed++;
    } catch (err) {
      console.warn(`Backup failed for desk "${desk.name || desk.driveId}":`, err.message);
      failed++;
    }
  }

  for (const ch of channels || []) {
    if (!channelNeedsBackupUpload(ch)) continue;
    const label = ch.name || ch.handle || ch.channelId;
    progress(`Backing up channel "${label}"...`);
    try {
      const { id: _legacyId, ...rest } = ch;
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
      await onSetDriveId(ch.driveId, 'channels', driveFile.id, { modifiedTime: driveFile.modifiedTime });
      backed++;
    } catch (err) {
      console.warn(`Backup failed for channel "${label}":`, err.message);
      failed++;
    }
  }

  return { backed, failed };
}

// ---------------------------------------------------------------------------
// Classification-based sync (index-driven; replaces full folder scans)
// ---------------------------------------------------------------------------

async function listFolderContents(folderId, accessToken) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const f = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime)');
  const results = [];
  let pageToken = null;
  do {
    const pt = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const r = await fetchGoogleApisGet(
      `/drive/v3/files?q=${q}&fields=${f}&pageSize=1000${pt}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return results;
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
}

/**
 * Compares the Drive index against local item/channel/desk arrays to produce
 * two lists: items that need uploading (toBackup) and index entries that need
 * downloading (toPull). Pure — no I/O calls.
 *
 * @param {object|null} driveIndex  - Parsed _infodepo_index.json (or null)
 * @param {Array}       items       - Local book/note/video records (IMAGES_STORE excluded)
 * @param {Array}       channels    - Local channel records
 * @param {Array}       desks       - Local desk records
 * @returns {{ toBackup: Array<{record,storeName}>, toPull: Array }}
 */
export function classifyChanges(driveIndex, items, channels, desks) {
  const toBackup = [];
  const toPull   = [];
  const localDriveIds = new Set();

  const indexByDriveId = new Map(
    (driveIndex?.items || []).map(e => [String(e.driveId || '').trim(), e])
  );

  const checkRecord = (record, storeName) => {
    const did = String(record.driveId || '').trim();
    if (did && !isTempDriveId(did)) localDriveIds.add(did);
    if (!did || isTempDriveId(did)) { toBackup.push({ record, storeName }); return; }
    const entry = indexByDriveId.get(did);
    if (!entry) { toBackup.push({ record, storeName }); return; }
    const lm = timeMs(record.localModifiedAt);
    const im = timeMs(entry.modifiedTime);
    const dm = timeMs(record.modifiedTime);
    if (lm != null && im != null && lm > im) { toBackup.push({ record, storeName }); return; }
    if (im != null && dm != null && im > dm) toPull.push(entry);
    // else: clean
  };

  for (const item of items || []) {
    if (item.idbStore === 'images') continue;
    checkRecord(item, item.idbStore || 'books');
  }
  for (const ch of channels || []) checkRecord(ch, 'channels');
  for (const dk of desks || []) checkRecord(dk, 'desks');

  // Index entries absent locally → need pull
  for (const entry of driveIndex?.items || []) {
    const did = String(entry.driveId || '').trim();
    if (did && !localDriveIds.has(did)) toPull.push(entry);
  }

  // Deduplicate toPull (an entry can satisfy both "index newer" and "absent locally")
  const seen = new Set();
  const toPullDeduped = toPull.filter(e => {
    const d = String(e.driveId || '').trim();
    if (!d || seen.has(d)) return false;
    seen.add(d);
    return true;
  });

  return { toBackup, toPull: toPullDeduped };
}

/**
 * Uploads only the pre-classified dirty items/channels/desks. Mirrors the
 * logic of backupAllToGDrive but processes toBackup instead of iterating
 * everything. Returns updatedEntries so the caller can patch syncItems before
 * writing the owner index.
 *
 * @param {Array}  toBackup  - [{ record, storeName }] from classifyChanges
 * @param {object} options   - Same options as backupAllToGDrive plus `items` (full list, for sidecars)
 * @returns {{ backed: number, failed: number, updatedEntries: Array }}
 */
export async function backupChangedItems(toBackup, {
  accessToken,
  folderId,
  items,
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
  const updatedEntries = []; // { oldDriveId, storeName, driveId, modifiedTime, driveFolderId? }

  const postMultipart = (blob, name, mimeType, targetParentId) =>
    drivePostMultipart(accessToken, blob, name, mimeType, targetParentId || folderId);
  const patchMultipart = (fileId, blob, name, mimeType) =>
    drivePatchMultipart(accessToken, fileId, blob, name, mimeType);

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

  for (const { record, storeName } of toBackup) {
    if (storeName === 'channels') {
      if (!channelNeedsBackupUpload(record)) continue;
      const label = record.name || record.handle || record.channelId;
      progress(`Backing up channel "${label}"...`);
      try {
        const { id: _legacyId, ...rest } = record;
        const payload = JSON.stringify({ _type: CHANNEL_JSON_MARKER, ...rest });
        const blob = new Blob([payload], { type: 'application/json' });
        const safeName = String(label).replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${safeName}.channel.json`;
        const did = String(record.driveId || '').trim();
        let driveFile;
        if (did) {
          try {
            driveFile = await patchMultipart(did, blob, fileName, 'application/json');
          } catch (patchErr) {
            if (patchErr.status === 404 || patchErr.status === 403) {
              driveFile = await postMultipart(blob, fileName, 'application/json');
            } else throw patchErr;
          }
        } else {
          driveFile = await postMultipart(blob, fileName, 'application/json');
        }
        await onSetDriveId(record.driveId, 'channels', driveFile.id, { modifiedTime: driveFile.modifiedTime });
        updatedEntries.push({ oldDriveId: record.driveId, storeName: 'channels', driveId: driveFile.id, modifiedTime: driveFile.modifiedTime });
        backed++;
      } catch (err) {
        console.warn(`Backup failed for channel "${record.name || record.channelId}":`, err.message);
        failed++;
      }
      continue;
    }

    if (storeName === 'desks') {
      if (!deskNeedsBackupUpload(record)) continue;
      progress(`Backing up desk "${record.name || `desk-${record.driveId}`}"...`);
      try {
        let capturedDriveId, capturedModifiedTime;
        const wrappedSetDriveId = async (id, sn, driveId, meta) => {
          await onSetDriveId(id, sn, driveId, meta);
          capturedDriveId = driveId;
          capturedModifiedTime = meta?.modifiedTime;
        };
        await backupSingleDesk(record, { accessToken, folderId, onSetDriveId: wrappedSetDriveId });
        if (capturedDriveId) {
          updatedEntries.push({ oldDriveId: record.driveId, storeName: 'desks', driveId: capturedDriveId, modifiedTime: capturedModifiedTime });
        }
        backed++;
      } catch (err) {
        console.warn(`Backup failed for desk "${record.name || record.driveId}":`, err.message);
        failed++;
      }
      continue;
    }

    // Items (books, notes, videos)
    if (!record.data || !noteBundleNeedsBackup(record)) continue;
    progress(`Backing up "${record.name}"...`);
    try {
      const isNote = record.type === 'text/markdown' || record.idbStore === 'notes';
      const hasAssets = isNote && Array.isArray(record.assets) && record.assets.length > 0;

      if (isNote && hasAssets) {
        const folderName = record.name.replace(/\.(md|markdown|mdown|mkd)$/i, '');
        const existingFolderId = String(record.driveFolderId || '').trim();
        const existingMdId = String(record.driveId || '').trim();
        let newFolderId = existingFolderId;

        if (!existingFolderId || !existingMdId) {
          const folder = await createFolder(folderName, folderId);
          newFolderId = folder.id;
          const driveFile = await postMultipart(record.data, record.name, record.type, folder.id);
          await onSetDriveId(record.driveId, record.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });
          updatedEntries.push({ oldDriveId: record.driveId, storeName: record.idbStore, driveId: driveFile.id, modifiedTime: driveFile.modifiedTime, driveFolderId: folder.id });

          const assetDriveIds = [];
          for (const asset of record.assets) {
            if (asset.driveId) { assetDriveIds.push({ name: asset.name, driveId: asset.driveId }); continue; }
            progress(`Backing up asset "${asset.name}" for "${record.name}"...`);
            const af = await postMultipart(asset.data, asset.name, asset.type, folder.id);
            assetDriveIds.push({ name: asset.name, driveId: af.id });
            backed++;
          }
          if (onSetNoteFolderData) await onSetNoteFolderData(record.driveId, folder.id, assetDriveIds);
          backed++;
        } else {
          let lastMdTime = record.modifiedTime;
          if (itemNeedsBackupUpload(record)) {
            const mdRes = await patchMultipart(existingMdId, record.data, record.name, record.type);
            lastMdTime = mdRes.modifiedTime;
            await onSetDriveId(record.driveId, record.idbStore, existingMdId, { modifiedTime: mdRes.modifiedTime });
            updatedEntries.push({ oldDriveId: record.driveId, storeName: record.idbStore, driveId: existingMdId, modifiedTime: mdRes.modifiedTime, driveFolderId: existingFolderId });
            backed++;
          }
          const assetDriveIds = [];
          let anyNewAsset = false;
          for (const asset of record.assets) {
            if (String(asset.driveId || '').trim()) { assetDriveIds.push({ name: asset.name, driveId: asset.driveId }); continue; }
            progress(`Backing up asset "${asset.name}" for "${record.name}"...`);
            const af = await postMultipart(asset.data, asset.name, asset.type, existingFolderId);
            assetDriveIds.push({ name: asset.name, driveId: af.id });
            anyNewAsset = true;
            backed++;
          }
          if (anyNewAsset && onSetNoteFolderData) {
            await onSetNoteFolderData(record.driveId, existingFolderId, assetDriveIds);
            const mdMeta = lastMdTime;
            await onSetDriveId(record.driveId, record.idbStore, existingMdId, {
              modifiedTime: typeof mdMeta === 'string' ? mdMeta : (mdMeta?.toISOString?.() || new Date().toISOString()),
            });
          }
        }
      } else {
        const isYoutube = record.type === 'application/x-youtube';
        const driveName = isYoutube ? record.name.replace(/\.youtube$/i, '.json') : record.name;
        const driveMime = isYoutube ? 'application/json' : record.type;
        const did = String(record.driveId || '').trim();
        let driveFile;
        if (did) {
          try {
            driveFile = await patchMultipart(did, record.data, driveName, driveMime);
          } catch (patchErr) {
            if (patchErr.status === 404 || patchErr.status === 403) {
              console.warn(`PATCH ${patchErr.status} for "${record.name}", uploading as new file.`);
              driveFile = await postMultipart(record.data, driveName, driveMime);
            } else throw patchErr;
          }
        } else {
          driveFile = await postMultipart(record.data, driveName, driveMime);
        }
        await onSetDriveId(record.driveId, record.idbStore, driveFile.id, { modifiedTime: driveFile.modifiedTime });
        updatedEntries.push({ oldDriveId: record.driveId, storeName: record.idbStore, driveId: driveFile.id, modifiedTime: driveFile.modifiedTime });
        backed++;
        if (record.type === 'application/pdf' && setPdfAnnotationDriveSync) {
          try {
            await setPdfAnnotationDriveSync(record.driveId, record.idbStore, { pdfDriveId: driveFile.id });
          } catch (e) {
            console.warn(`[backup] pdf sidecar pdfDriveId link failed for "${record.name}":`, e?.message);
          }
        }
      }
    } catch (err) {
      console.warn(`Backup failed for "${record.name}":`, err.message);
      failed++;
    }
  }

  // PDF annotation sidecars: check all items (annotation can change independently of PDF)
  if (getPdfAnnotationSidecar && setPdfAnnotationDriveSync) {
    for (const item of items || []) {
      if (item.type !== 'application/pdf' || !item.data) continue;
      const pdfDid = String(item.driveId || '').trim();
      if (!pdfDid) continue;
      let sc;
      try { sc = await getPdfAnnotationSidecar(item.driveId, item.idbStore); } catch { continue; }
      if (!sc || !pdfAnnotationSidecarNeedsBackup(sc)) continue;
      const annName = pdfAnnotationSidecarFileName(item.name);
      const payload = serializePdfAnnotationSidecar({
        pdfDriveId: pdfDid, itemDriveId: item.driveId, idbStore: item.idbStore, annotations: sc.annotations || [],
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
              annDriveFile = await postMultipart(blob, annName, 'application/json');
            } else throw patchErr;
          }
        } else {
          annDriveFile = await postMultipart(blob, annName, 'application/json');
        }
        await setPdfAnnotationDriveSync(item.driveId, item.idbStore, {
          annotationDriveId: annDriveFile.id, modifiedTime: annDriveFile.modifiedTime, pdfDriveId: pdfDid,
        });
        backed++;
      } catch (err) {
        console.warn(`Annotation backup failed for "${item.name}":`, err.message);
        failed++;
      }
    }
  }

  // Cover image sidecars
  if (onSetCoverImageDriveSync) {
    for (const item of items || []) {
      if (!item.data || !item.coverImage?.data || item.coverImageDriveId) continue;
      const coverBlob = item.coverImage.data;
      const coverMime = item.coverImage.type || 'image/jpeg';
      const sidecarName = coverSidecarFilename(item.name, coverMime);
      progress(`Backing up cover for "${item.name}"...`);
      try {
        const driveFile = await postMultipart(coverBlob, sidecarName, coverMime);
        await onSetCoverImageDriveSync(item.driveId, item.idbStore, {
          coverImageDriveId: driveFile.id, modifiedTime: driveFile.modifiedTime,
        });
        backed++;
      } catch (err) {
        console.warn(`Cover sidecar backup failed for "${item.name}":`, err.message);
        failed++;
      }
    }
  }

  return { backed, failed, updatedEntries };
}

/**
 * Downloads only the pre-classified index entries that need pulling. Fetches
 * each item directly by driveId — no folder listing required for main content.
 * Note bundles with a driveFolderId list their subfolder to retrieve assets.
 *
 * @param {Array}  toPull   - Index entries from classifyChanges
 * @param {object} options
 * @returns {{ added: number, updated: number, skipped: number }}
 */
export async function pullChangedItems(toPull, {
  accessToken,
  upsertDriveBook,
  upsertDriveChannel,
  upsertDriveDesk,
  lazyBooks = false,
  onProgress,
  onBatchComplete,
}) {
  const counts = { added: 0, updated: 0, skipped: 0 };
  const progress = onProgress || (() => {});
  const total = toPull.length;
  let idx = 0;
  let batchProcessed = 0;
  const batchTick = () => {
    batchProcessed++;
    if (onBatchComplete && batchProcessed % 20 === 0) onBatchComplete();
  };

  for (const entry of toPull) {
    idx++;
    progress(`${idx} / ${total}`);
    const driveId = String(entry.driveId || '').trim();
    if (!driveId) { counts.skipped++; batchTick(); continue; }

    try {
      if (entry.type === 'infodepo-channel' && upsertDriveChannel) {
        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) { counts.skipped++; batchTick(); continue; }
        const parsed = JSON.parse(await blobRes.text());
        const { _type, ...channelData } = parsed;
        const driveFile = { driveId, name: entry.name, mimeType: 'application/json', modifiedTime: entry.modifiedTime };
        const action = await upsertDriveChannel(driveFile, channelData);
        if (action === 'added') counts.added++;
        else if (action === 'updated') counts.updated++;
        else counts.skipped++;
        batchTick(); continue;
      }

      if (entry.type === 'infodepo-desk' && upsertDriveDesk) {
        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) { counts.skipped++; batchTick(); continue; }
        const parsed = JSON.parse(await blobRes.text());
        const { _type, ...deskData } = parsed;
        const driveFile = { driveId, name: entry.name, mimeType: 'application/json', modifiedTime: entry.modifiedTime };
        const action = await upsertDriveDesk(driveFile, deskData);
        if (action === 'added') counts.added++;
        else if (action === 'updated') counts.updated++;
        else counts.skipped++;
        batchTick(); continue;
      }

      if (upsertDriveBook) {
        const isMarkdown = /\.(md|markdown|mdown|mkd)$/i.test(entry.name) || entry.type === 'text/markdown';
        const isYoutube = entry.type === 'application/x-youtube';
        const isJson = !isMarkdown && !isYoutube && (entry.name?.endsWith('.json') || entry.type === 'application/json');
        const isBinary = !isMarkdown && !isYoutube && !isJson;

        if (lazyBooks && isBinary) {
          const driveFile = { driveId, name: entry.name, mimeType: entry.type, size: entry.size || 0, modifiedTime: entry.modifiedTime, sharedWith: entry.sharedWith || [], tags: entry.tags || [], ...(entry.ownerEmail ? { ownerEmail: entry.ownerEmail } : {}) };
          const action = await upsertDriveBook(driveFile, null);
          if (action === 'added') counts.added++;
          else if (action === 'updated') counts.updated++;
          else counts.skipped++;
          batchTick(); continue;
        }

        if (isMarkdown && entry.driveFolderId) {
          // Note bundle: list subfolder for image assets
          const subFiles = await listFolderContents(entry.driveFolderId, accessToken);
          const bundleImgs = subFiles.filter(f => IMAGE_MIME_TYPES.includes(f.mimeType));
          const mdBlobRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!mdBlobRes.ok) { counts.skipped++; batchTick(); continue; }
          const mdBlob = await mdBlobRes.blob();
          const assets = [];
          for (const imgFile of bundleImgs) {
            const blobRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(imgFile.driveId)}?alt=media`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (blobRes.ok) assets.push({ name: imgFile.name, data: await blobRes.blob(), type: imgFile.mimeType, driveId: imgFile.driveId });
          }
          const bundleFile = { driveId, name: entry.name, mimeType: 'text/markdown', modifiedTime: entry.modifiedTime, driveFolderId: entry.driveFolderId, sharedWith: entry.sharedWith || [], tags: entry.tags || [] };
          const action = await upsertDriveBook(bundleFile, mdBlob, assets);
          if (action === 'added') counts.added++;
          else if (action === 'updated') counts.updated++;
          else counts.skipped++;
          batchTick(); continue;
        }

        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) { counts.skipped++; batchTick(); continue; }
        let blob = await blobRes.blob();
        let effectiveFile = { driveId, name: entry.name, mimeType: entry.type, modifiedTime: entry.modifiedTime, sharedWith: entry.sharedWith || [], tags: entry.tags || [], ...(entry.ownerEmail ? { ownerEmail: entry.ownerEmail } : {}) };

        if (isYoutube || isJson) {
          const text = await blob.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed.url && /youtube\.com|youtu\.be/.test(parsed.url)) {
              const safeTitle = (parsed.title || 'YouTube Video').replace(/[/\\?%*:|"<>]/g, '-');
              effectiveFile = { ...effectiveFile, name: safeTitle + '.youtube', mimeType: 'application/x-youtube' };
              blob = new Blob([text], { type: 'application/x-youtube' });
            } else if (isJson) {
              blob = new Blob([text], { type: entry.type });
            }
          } catch { /* not valid JSON — fall through */ }
        }

        const action = await upsertDriveBook(effectiveFile, blob);
        if (action === 'added') counts.added++;
        else if (action === 'updated') counts.updated++;
        else counts.skipped++;
      }
    } catch (err) {
      console.warn(`[pullChangedItems] failed for "${entry.name}":`, err.message);
      counts.skipped++;
    }
    batchTick();
  }

  return counts;
}

/**
 * Lists the root Drive folder and syncs images (Phase 3) and sidecars (Phase 4).
 * Called after backupChangedItems + pullChangedItems to handle assets not tracked
 * by the index (note-embedded images, PDF annotation sidecars, cover sidecars).
 *
 * @returns {{ added: number, updated: number, skipped: number }}
 */
export async function syncFolderAssetsAndSidecars({
  accessToken,
  folderId,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  getNotes,
  getBookByName,
  upsertDriveCoverImage,
  upsertDrivePdfAnnotation,
  getAnnotationByDriveId,
  onProgress,
  onBatchComplete,
  // Optional: fallback scan for content files not tracked by the owner index.
  // When provided, any EPUB/PDF/TXT/Markdown/Channel/Desk file in the Drive folder
  // whose driveId is not in indexTrackedDriveIds will be pulled if locally absent
  // or if the Drive copy is newer.
  indexTrackedDriveIds,
  getBookByDriveId,
  upsertDriveBook,
  getChannelByDriveId,
  upsertDriveChannel,
  getDeskByDriveId,
  upsertDriveDesk,
  lazyBooks = false,
}) {
  const progress = onProgress || (() => {});
  const counts = { added: 0, updated: 0, skipped: 0 };

  progress('Listing Drive files…');
  let allRawItems;
  try {
    allRawItems = await listFolderContents(folderId, accessToken);
  } catch (err) {
    console.warn('[syncFolderAssetsAndSidecars] folder listing failed:', err.message);
    return counts;
  }

  const allDriveFiles = allRawItems.filter(f => ALL_SYNCABLE_MIME_TYPES.includes(f.mimeType));
  const imageFiles = allDriveFiles.filter(f => IMAGE_MIME_TYPES.includes(f.mimeType));
  const jsonFiles  = allDriveFiles.filter(f => f.mimeType === 'application/json' && f.name !== OWNER_INDEX_FILENAME);

  const coverFiles     = imageFiles.filter(f =>  isCoverSidecarFilename(f.name));
  const userImageFiles = imageFiles.filter(f => !isCoverSidecarFilename(f.name));
  const annotationFiles = jsonFiles.filter(f => isPdfAnnotationSidecarFilename(f.name));

  const totalTracked = annotationFiles.length + userImageFiles.length;
  let doneTracked = 0;
  const progressTracked = (label) => {
    doneTracked++;
    progress(`${label} (${doneTracked} / ${totalTracked})`);
  };

  let batchProcessed = 0;
  const batchTick = () => {
    batchProcessed++;
    if (onBatchComplete && batchProcessed % 20 === 0) onBatchComplete();
  };

  // PDF annotation sidecars (JSON files not tracked by the index)
  if (annotationFiles.length > 0 && upsertDrivePdfAnnotation) {
    for (const driveFile of annotationFiles) {
      try {
        // Pre-check: skip download if local annotation is already at same/newer modifiedTime
        if (getAnnotationByDriveId) {
          const existing = await getAnnotationByDriveId(driveFile.driveId);
          if (existing?.modifiedTime && new Date(driveFile.modifiedTime) <= new Date(existing.modifiedTime)) {
            counts.skipped++;
            progressTracked(driveFile.name);
            continue;
          }
        }
        progressTracked(driveFile.name);
        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.driveId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) continue;
        const text = await blobRes.text();
        const result = await upsertDrivePdfAnnotation(driveFile, text);
        if (result === 'added') counts.added++;
        else if (result === 'updated') counts.updated++;
        else counts.skipped++;
        batchTick();
      } catch (e) {
        console.warn(`PDF annotation sidecar sync failed for ${driveFile.name}:`, e);
        progressTracked(driveFile.name);
      }
    }
  }

  // Note-attached images (Phase 3)
  if (userImageFiles.length > 0 && upsertDriveImage) {
    const noteDriveIdByImageName = new Map();
    if (getNotes) {
      try {
        const notes = await getNotes();
        for (const note of notes) {
          if (!note.data) continue;
          const text = typeof note.data === 'string' ? note.data : await note.data.text();
          const imgRefs = text.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
          for (const ref of imgRefs) {
            const m = ref.match(/!\[[^\]]*\]\(([^)]+)\)/);
            if (m) noteDriveIdByImageName.set(m[1], note.driveId);
          }
        }
      } catch (err) {
        console.warn('Failed to scan notes for image references:', err);
      }
    }

    for (const driveFile of userImageFiles) {
      const existing = (getImageByDriveId && await getImageByDriveId(driveFile.driveId))
        || (getImageByName && await getImageByName(driveFile.name));

      const driveIsNewer = existing
        ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
        : true;

      if (existing && !driveIsNewer) { counts.skipped++; progressTracked(driveFile.name); continue; }

      progressTracked(driveFile.name);
      const blobRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.driveId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!blobRes.ok) { counts.skipped++; continue; }
      const blob = await blobRes.blob();
      const noteDriveId = noteDriveIdByImageName.get(driveFile.name) || (existing ? existing.noteDriveId : '');
      const action = await upsertDriveImage(driveFile, blob, noteDriveId);
      if (action === 'added') counts.added++;
      else if (action === 'updated') counts.updated++;
      else counts.skipped++;
      batchTick();
    }
  }

  // Cover sidecars (Phase 4) — silent, not counted in progress
  if (coverFiles.length > 0 && upsertDriveCoverImage) {
    for (const driveFile of coverFiles) {
      const parentItemName = String(driveFile.name).replace(/\.infodepo-cover\.[^.]+$/, '');
      const parentItem = getBookByName ? await getBookByName(parentItemName) : undefined;
      if (parentItem?.coverImageDriveId === driveFile.driveId) continue;
      const blobRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.driveId)}?alt=media`,
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

  // Phase 5: fallback scan for content files (books, channels, desks) in the Drive
  // folder that are NOT tracked by the owner index. Catches files backed up before
  // the index system existed, or manually placed in the folder.
  if (upsertDriveBook || upsertDriveChannel || upsertDriveDesk) {
    const tracked = indexTrackedDriveIds instanceof Set ? indexTrackedDriveIds : new Set();
    const unindexedContent = allDriveFiles.filter(f => {
      if (!SUPPORTED_MIME_TYPES.includes(f.mimeType)) return false;
      if (f.name === OWNER_INDEX_FILENAME) return false;
      if (IMAGE_MIME_TYPES.includes(f.mimeType)) return false;
      if (isPdfAnnotationSidecarFilename(f.name)) return false;
      if (isCoverSidecarFilename(f.name)) return false;
      return !tracked.has(String(f.driveId || '').trim());
    });
    console.log('[InfoDepo][Phase5] folder listing:', {
      allDriveFiles: allDriveFiles.length,
      trackedByIndex: tracked.size,
      unindexedContent: unindexedContent.length,
      fileNames: allDriveFiles.map(f => `${f.name} (${f.mimeType})`),
    });

    for (const driveFile of unindexedContent) {
      try {
        if (driveFile.mimeType === 'application/json') {
          // Must download to detect type (channel / desk / YouTube / other)
          const blobRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.driveId)}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!blobRes.ok) { counts.skipped++; batchTick(); continue; }
          let parsed;
          try { parsed = JSON.parse(await blobRes.text()); } catch { counts.skipped++; batchTick(); continue; }

          if (parsed._type === CHANNEL_JSON_MARKER && parsed.channelId && upsertDriveChannel) {
            const existingCh = getChannelByDriveId ? await getChannelByDriveId(driveFile.driveId) : null;
            const chNewer = !existingCh || !existingCh.modifiedTime
              || new Date(driveFile.modifiedTime) > new Date(existingCh.modifiedTime);
            if (!chNewer) { counts.skipped++; batchTick(); continue; }
            const { _type, ...channelData } = parsed;
            const action = await upsertDriveChannel(driveFile, channelData);
            if (action === 'added') counts.added++;
            else if (action === 'updated') counts.updated++;
            else counts.skipped++;
          } else if (parsed._type === DESK_JSON_MARKER && upsertDriveDesk) {
            const existingDk = getDeskByDriveId ? await getDeskByDriveId(driveFile.driveId) : null;
            const dkNewer = !existingDk || !existingDk.modifiedTime
              || new Date(driveFile.modifiedTime) > new Date(existingDk.modifiedTime);
            if (!dkNewer) { counts.skipped++; batchTick(); continue; }
            const { _type, ...deskData } = parsed;
            const action = await upsertDriveDesk(driveFile, deskData);
            if (action === 'added') counts.added++;
            else if (action === 'updated') counts.updated++;
            else counts.skipped++;
          } else if (parsed.url && /youtube\.com|youtu\.be/.test(parsed.url) && upsertDriveBook) {
            const existingBook = getBookByDriveId ? await getBookByDriveId(driveFile.driveId) : null;
            const bookNewer = !existingBook || !existingBook.modifiedTime
              || new Date(driveFile.modifiedTime) > new Date(existingBook.modifiedTime);
            if (!bookNewer) { counts.skipped++; batchTick(); continue; }
            const safeTitle = (parsed.title || 'YouTube Video').replace(/[/\\?%*:|"<>]/g, '-');
            const ytBlob = new Blob([JSON.stringify(parsed)], { type: 'application/x-youtube' });
            const effectiveFile = { ...driveFile, name: safeTitle + '.youtube', mimeType: 'application/x-youtube' };
            const action = await upsertDriveBook(effectiveFile, ytBlob);
            if (action === 'added') counts.added++;
            else if (action === 'updated') counts.updated++;
            else counts.skipped++;
          } else {
            counts.skipped++;
          }
        } else if (upsertDriveBook) {
          // Binary or text content file (EPUB, PDF, TXT, Markdown)
          const existingBook = getBookByDriveId
            ? await getBookByDriveId(driveFile.driveId)
            : null;
          const bookNewer = !existingBook || !existingBook.modifiedTime
            || new Date(driveFile.modifiedTime) > new Date(existingBook.modifiedTime);
          if (!bookNewer) { counts.skipped++; batchTick(); continue; }

          const isMarkdown = driveFile.mimeType === 'text/markdown'
            || /\.(md|markdown|mdown|mkd)$/i.test(driveFile.name);
          const isBinary = !isMarkdown;

          if (lazyBooks && isBinary) {
            const action = await upsertDriveBook(driveFile, null);
            if (action === 'added') counts.added++;
            else if (action === 'updated') counts.updated++;
            else counts.skipped++;
          } else {
            const blobRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.driveId)}?alt=media`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!blobRes.ok) { counts.skipped++; batchTick(); continue; }
            const blob = await blobRes.blob();
            const action = await upsertDriveBook(driveFile, blob);
            if (action === 'added') counts.added++;
            else if (action === 'updated') counts.updated++;
            else counts.skipped++;
          }
        } else {
          counts.skipped++;
        }
      } catch (err) {
        console.warn(`[syncFolderAssetsAndSidecars] non-indexed content failed for "${driveFile.name}":`, err?.message);
        counts.skipped++;
      }
      batchTick();
    }
  }

  return counts;
}
