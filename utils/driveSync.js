const SUPPORTED_MIME_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json', // YouTube URL entries backed up from the app
];

/**
 * Syncs the Google Drive folder to local IndexedDB.
 * Downloads all supported files from Drive that are new or updated since last sync.
 * Returns: { added, updated, skipped }
 */
export async function syncDriveToLocal({
  accessToken,
  apiKey,
  folderId,
  books,            // current items array (non-YouTube) for deduplication
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  onProgress,
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
  const driveFiles = (data.files || [])
    .filter(f => SUPPORTED_MIME_TYPES.includes(f.mimeType))
    .map(f => ({
      driveId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: parseInt(f.size) || 0,
      modifiedTime: f.modifiedTime,
    }));

  // Most recently modified first
  driveFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

  const counts = { added: 0, updated: 0, skipped: 0 };

  for (const driveFile of driveFiles) {
    progress(`Processing ${driveFile.name}...`);

    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const driveIsNewer = existing
      ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
      : true;

    // Already up to date
    if (existing && !driveIsNewer) {
      if (!existing.driveId) await upsertDriveBook(driveFile, existing.data);
      counts.skipped++;
      continue;
    }

    // Download full blob
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

    // Detect YouTube URL JSON files and re-type them before storing
    if (driveFile.mimeType === 'application/json') {
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        if (parsed.url && /youtube\.com|youtu\.be/.test(parsed.url)) {
          const safeTitle = (parsed.title || 'YouTube Video').replace(/[/\\?%*:|"<>]/g, '-');
          effectiveFile = { ...driveFile, name: safeTitle + '.youtube', mimeType: 'application/x-youtube' };
          blob = new Blob([text], { type: 'application/x-youtube' });
        }
      } catch { /* not valid JSON or not a YouTube entry — skip */ }
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

  progress('');
  return { backed, failed };
}
