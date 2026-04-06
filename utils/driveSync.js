import { SHARE_MANIFEST_NAME } from './shareManifest.js';

const CHANNEL_JSON_MARKER = 'infodepo-channel';

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
  apiKey,
  folderId,
  books,
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  getNotes,
  upsertDriveChannel,
  onProgress,
  allowedDriveIds,
}) {
  const progress = onProgress || (() => {});

  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  const listFolderContents = async (id) => {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const f = encodeURIComponent('files(id,name,mimeType,size,modifiedTime)');
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${f}&key=${apiKey}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return [];
    return ((await r.json()).files || []).map(f => ({
      driveId: f.id, name: f.name, mimeType: f.mimeType,
      size: parseInt(f.size) || 0, modifiedTime: f.modifiedTime,
    }));
  };

  const downloadFile = async (driveId) => {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return r.ok ? r.blob() : null;
  };

  progress('Listing Drive files...');
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime)');
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&key=${apiKey}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || res.statusText);
  }
  const data = await res.json();
  const allRawItems = data.files || [];

  // Separate folders from files.
  const driveFolders = allRawItems
    .filter(f => f.mimeType === FOLDER_MIME)
    .map(f => ({ driveId: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime }));

  const allDriveFiles = allRawItems
    .filter(f => ALL_SYNCABLE_MIME_TYPES.includes(f.mimeType))
    .map(f => ({
      driveId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: parseInt(f.size) || 0,
      modifiedTime: f.modifiedTime,
    }));

  const isManifest = (f) => f.name === SHARE_MANIFEST_NAME;

  let contentFiles = allDriveFiles.filter(
    (f) => SUPPORTED_MIME_TYPES.includes(f.mimeType) && !isManifest(f)
  );
  let imageFiles = allDriveFiles.filter(
    (f) => IMAGE_MIME_TYPES.includes(f.mimeType) && !isManifest(f)
  );

  if (allowedDriveIds && allowedDriveIds.size > 0) {
    contentFiles = contentFiles.filter((f) => allowedDriveIds.has(f.driveId));
    imageFiles = imageFiles.filter((f) => allowedDriveIds.has(f.driveId));
  }

  contentFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  imageFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

  const counts = { added: 0, updated: 0, skipped: 0 };

  // Phase 0: sync note bundles stored as Drive folders (folder contains a .md + image assets).
  for (const folder of driveFolders) {
    progress(`Scanning note folder "${folder.name}"...`);
    const contents = await listFolderContents(folder.driveId);
    const mdFile = contents.find(f => /\.(md|markdown|mdown|mkd)$/i.test(f.name) && f.mimeType === 'text/markdown');
    if (!mdFile) continue; // not a note bundle

    const imgFiles = contents.filter(f => IMAGE_MIME_TYPES.includes(f.mimeType));

    let existing = await getBookByDriveId(mdFile.driveId);
    if (!existing) existing = await getBookByName(mdFile.name);

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(mdFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      counts.skipped++;
      continue;
    }

    progress(`Downloading note bundle "${folder.name}"...`);
    const mdBlob = await downloadFile(mdFile.driveId);
    if (!mdBlob) { counts.skipped++; continue; }

    const assets = [];
    for (const imgFile of imgFiles) {
      const blob = await downloadFile(imgFile.driveId);
      if (blob) assets.push({ name: imgFile.name, data: blob, type: imgFile.mimeType, driveId: imgFile.driveId });
    }

    const bundleFile = { ...mdFile, driveFolderId: folder.driveId };
    const action = await upsertDriveBook(bundleFile, mdBlob, assets);
    if (action === 'added') counts.added++;
    else counts.updated++;
  }

  // Phase 1: sync content files (books, notes, videos)
  for (const driveFile of contentFiles) {
    progress(`Processing ${driveFile.name}...`);

    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      if (!existing.driveId) await upsertDriveBook(driveFile, existing.data);
      counts.skipped++;
      continue;
    }

    const blobRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFile.driveId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!blobRes.ok) {
      console.warn(`Failed to download ${driveFile.name}:`, blobRes.statusText);
      counts.skipped++;
      continue;
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
          continue;
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
  }

  // Phase 2: sync image files
  if (imageFiles.length > 0 && upsertDriveImage) {
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

    for (const driveFile of imageFiles) {
      progress(`Processing image ${driveFile.name}...`);

      let existing = getImageByDriveId ? await getImageByDriveId(driveFile.driveId) : undefined;
      if (!existing && getImageByName) existing = await getImageByName(driveFile.name);

      const driveIsNewer = existing
        ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
        : true;

      if (existing && !driveIsNewer) {
        counts.skipped++;
        continue;
      }

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

  progress('');
  return counts;
}

/**
 * Download individual files by Drive ID (for linked shares where files are shared
 * via permissions, not in a folder listing). Fetches metadata first, then content.
 */
export async function syncSharedFilesByDriveId({
  accessToken,
  driveIds,
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  getImageByDriveId,
  getImageByName,
  upsertDriveImage,
  upsertDriveChannel,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  const counts = { added: 0, updated: 0, skipped: 0 };
  const ids = driveIds instanceof Set ? driveIds : new Set(driveIds || []);
  if (ids.size === 0) return counts;

  for (const driveId of ids) {
    progress(`Fetching metadata for ${driveId.slice(0, 12)}…`);
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?fields=id,name,mimeType,size,modifiedTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      console.warn(`[share sync] metadata failed for ${driveId}:`, metaRes.statusText);
      counts.skipped++;
      continue;
    }
    const meta = await metaRes.json();
    const driveFile = {
      driveId: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      size: parseInt(meta.size) || 0,
      modifiedTime: meta.modifiedTime,
    };

    const isImage = IMAGE_MIME_TYPES.includes(driveFile.mimeType);
    const isContent = SUPPORTED_MIME_TYPES.includes(driveFile.mimeType);
    if (!isImage && !isContent) { counts.skipped++; continue; }

    let existing;
    if (isImage) {
      existing = getImageByDriveId ? await getImageByDriveId(driveFile.driveId) : undefined;
      if (!existing && getImageByName) existing = await getImageByName(driveFile.name);
    } else {
      existing = await getBookByDriveId(driveFile.driveId);
      if (!existing) existing = await getBookByName(driveFile.name);
    }

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    if (existing && !driveIsNewer) {
      counts.skipped++;
      continue;
    }

    progress(`Downloading ${driveFile.name}…`);
    const blobRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!blobRes.ok) {
      console.warn(`[share sync] download failed for ${driveFile.name}:`, blobRes.statusText);
      counts.skipped++;
      continue;
    }
    let blob = await blobRes.blob();

    if (isImage) {
      const noteId = existing ? existing.noteId : 0;
      const action = await upsertDriveImage(driveFile, blob, noteId);
      if (action === 'added') counts.added++;
      else if (action === 'updated') counts.updated++;
      else counts.skipped++;
      continue;
    }

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
          continue;
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
  }

  progress('');
  return counts;
}

/**
 * Uploads all local items that have no driveId to Google Drive (backup).
 * After each successful upload, calls onSetDriveId to persist the Drive file ID.
 *
 * @param {object} options
 * @param {string}   options.accessToken         - OAuth2 Bearer token with drive.file scope
 * @param {string}   options.folderId            - Target Drive folder ID
 * @param {Array}    options.items               - All library items (books, notes, videos); notes carry their assets inline
 * @param {Function} options.onSetDriveId        - (id, storeName, driveId) => Promise
 * @param {Function} options.onSetNoteFolderData - (noteId, folderId, assetDriveIds) => Promise
 * @param {Function} options.onProgress          - (message: string) => void
 * @returns {Promise<{ backed: number, failed: number }>}
 */
export async function backupAllToGDrive({
  accessToken,
  folderId,
  items,
  channels,
  onSetDriveId,
  onSetNoteFolderData,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  let backed = 0;
  let failed = 0;

  const uploadBlob = async (blob, name, mimeType, targetParentId) => {
    const parentId = targetParentId || folderId;
    const metadata = {
      name,
      mimeType: mimeType || 'application/octet-stream',
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
    return res.json(); // { id, name }
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
    return res.json(); // { id, name }
  };

  // Back up main content items (books, notes, videos)
  const pending = (items || []).filter(item => item.driveId === '' && item.data);
  for (const item of pending) {
    progress(`Backing up "${item.name}"...`);
    try {
      const isNote = item.type === 'text/markdown' || item.idbStore === 'notes';
      const hasAssets = isNote && Array.isArray(item.assets) && item.assets.length > 0;

      if (isNote && hasAssets) {
        // Create a Drive folder to hold the .md file + its assets together.
        const folderName = item.name.replace(/\.(md|markdown|mdown|mkd)$/i, '');
        const folder = await createFolder(folderName, folderId);
        const driveFile = await uploadBlob(item.data, item.name, item.type, folder.id);
        await onSetDriveId(item.id, item.idbStore, driveFile.id);

        const assetDriveIds = [];
        for (const asset of item.assets) {
          if (asset.driveId) {
            assetDriveIds.push({ name: asset.name, driveId: asset.driveId });
            continue;
          }
          progress(`Backing up asset "${asset.name}" for "${item.name}"...`);
          const af = await uploadBlob(asset.data, asset.name, asset.type, folder.id);
          assetDriveIds.push({ name: asset.name, driveId: af.id });
          backed++;
        }
        if (onSetNoteFolderData) await onSetNoteFolderData(item.id, folder.id, assetDriveIds);
      } else {
        // YouTube links are stored locally as .youtube blobs; upload to Drive as .json
        const isYoutube = item.type === 'application/x-youtube';
        const driveName = isYoutube ? item.name.replace(/\.youtube$/i, '.json') : item.name;
        const driveMime = isYoutube ? 'application/json' : item.type;
        const driveFile = await uploadBlob(item.data, driveName, driveMime);
        await onSetDriveId(item.id, item.idbStore, driveFile.id);
      }
      backed++;
    } catch (err) {
      console.warn(`Backup failed for "${item.name}":`, err.message);
      failed++;
    }
  }

  // Back up channels
  const pendingChannels = (channels || []).filter(ch => ch.driveId === '');
  for (const ch of pendingChannels) {
    const label = ch.name || ch.handle || ch.channelId;
    progress(`Backing up channel "${label}"...`);
    try {
      const { id, driveId, ...rest } = ch;
      const payload = JSON.stringify({ _type: CHANNEL_JSON_MARKER, ...rest });
      const blob = new Blob([payload], { type: 'application/json' });
      const safeName = label.replace(/[/\\?%*:|"<>]/g, '-');
      const driveFile = await uploadBlob(blob, `${safeName}.channel.json`, 'application/json');
      await onSetDriveId(id, 'channels', driveFile.id);
      backed++;
    } catch (err) {
      console.warn(`Backup failed for channel "${label}":`, err.message);
      failed++;
    }
  }

  progress('');
  return { backed, failed };
}
