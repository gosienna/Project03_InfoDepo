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
  const allDriveFiles = (data.files || [])
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
  getNotes,
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
 * @param {string}   options.accessToken  - OAuth2 Bearer token with drive.file scope
 * @param {string}   options.folderId     - Target Drive folder ID
 * @param {Array}    options.items        - All library items (books, notes, videos)
 * @param {Array}    options.images       - All image records from the images store
 * @param {Function} options.onSetDriveId - (id, storeName, driveId) => Promise
 * @param {Function} options.onProgress   - (message: string) => void
 * @returns {Promise<{ backed: number, failed: number }>}
 */
export async function backupAllToGDrive({
  accessToken,
  folderId,
  items,
  images,
  channels,
  onSetDriveId,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  let backed = 0;
  let failed = 0;

  const uploadBlob = async (blob, name, mimeType) => {
    const metadata = {
      name,
      mimeType: mimeType || 'application/octet-stream',
      ...(folderId ? { parents: [folderId] } : {}),
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

  // Back up main content items (books, notes, videos)
  const pending = (items || []).filter(item => item.driveId === '' && item.data);
  for (const item of pending) {
    progress(`Backing up "${item.name}"...`);
    try {
      // YouTube links are stored locally as .youtube blobs; upload to Drive as .json
      const isYoutube = item.type === 'application/x-youtube';
      const driveName = isYoutube ? item.name.replace(/\.youtube$/i, '.json') : item.name;
      const driveMime = isYoutube ? 'application/json' : item.type;
      const driveFile = await uploadBlob(item.data, driveName, driveMime);
      await onSetDriveId(item.id, item.idbStore, driveFile.id);
      backed++;
    } catch (err) {
      console.warn(`Backup failed for "${item.name}":`, err.message);
      failed++;
    }
  }

  // Back up image attachments
  const pendingImages = (images || []).filter(img => img.driveId === '' && img.data);
  for (const img of pendingImages) {
    progress(`Backing up image "${img.name}"...`);
    try {
      const driveFile = await uploadBlob(img.data, img.name, img.type);
      await onSetDriveId(img.id, 'images', driveFile.id);
      backed++;
    } catch (err) {
      console.warn(`Backup failed for image "${img.name}":`, err.message);
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
