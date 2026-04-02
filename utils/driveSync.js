const SUPPORTED_MIME_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'text/plain',
];

/**
 * Syncs the Google Drive folder with local IndexedDB.
 *
 * Priority: most recently modified Drive files download first.
 * Files that exceed the quota become metadata-only stubs.
 *
 * Returns:
 *   { added, updated, metadataOnly, skipped }         — normal completion
 *   { overLimit: true, excess, candidates, books }    — current usage already exceeds maxStorageBytes
 */
export async function syncDriveToLocal({
  accessToken,
  apiKey,
  folderId,
  maxStorageBytes,
  books,           // current local books array (from useIndexedDB state)
  getBookByDriveId,
  getBookByName,
  upsertDriveBook,
  onProgress,
}) {
  const progress = onProgress || (() => {});

  // Step 1: List all supported files from Drive
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
      driveModifiedTime: f.modifiedTime,
    }));

  // Step 2: Sort by modifiedTime descending (most recent first)
  driveFiles.sort((a, b) => new Date(b.driveModifiedTime) - new Date(a.driveModifiedTime));

  // Step 3: Tally current storage used by Drive-linked fully-downloaded books
  // Locally-imported books (no driveId) do NOT count against quota
  const driveSyncedBooks = books.filter(b => b.driveId && !b.isMetadataOnly);
  let bytesUsed = driveSyncedBooks.reduce((sum, b) => sum + (b.size || 0), 0);

  // Step 4: Over-limit check — if already over quota, return candidates for eviction
  if (bytesUsed > maxStorageBytes) {
    // Candidates: Drive-linked fully-downloaded books, oldest/largest first
    const candidates = [...driveSyncedBooks].sort((a, b) => {
      const timeDiff = new Date(a.driveModifiedTime || a.added) - new Date(b.driveModifiedTime || b.added);
      if (timeDiff !== 0) return timeDiff; // oldest first
      return (b.size || 0) - (a.size || 0); // largest first as tiebreaker
    });
    return {
      overLimit: true,
      excess: bytesUsed - maxStorageBytes,
      candidates,
      books,
    };
  }

  // Step 5: Process each Drive file
  const counts = { added: 0, updated: 0, metadataOnly: 0, skipped: 0 };

  for (const driveFile of driveFiles) {
    progress(`Processing ${driveFile.name}...`);

    // Look up existing record
    let existing = await getBookByDriveId(driveFile.driveId);
    if (!existing) existing = await getBookByName(driveFile.name);

    const driveIsNewer = existing
      ? !existing.driveModifiedTime || new Date(driveFile.driveModifiedTime) > new Date(existing.driveModifiedTime)
      : true;

    // Already downloaded and up to date → skip
    if (existing && !existing.isMetadataOnly && !driveIsNewer) {
      // Still backfill driveId if missing (locally-imported book matched by name)
      if (!existing.driveId) {
        await upsertDriveBook(driveFile, null);
      }
      counts.skipped++;
      continue;
    }

    // Decide whether to download based on quota
    const fitsQuota = (bytesUsed + driveFile.size) <= maxStorageBytes;

    if (fitsQuota && (driveIsNewer || !existing)) {
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
      const blob = await blobRes.blob();
      const action = await upsertDriveBook(driveFile, blob);
      bytesUsed += driveFile.size;
      if (action === 'added') counts.added++;
      else counts.updated++;
    } else {
      // Store metadata stub only
      await upsertDriveBook(driveFile, null);
      counts.metadataOnly++;
    }
  }

  progress('');
  return counts;
}

/**
 * Given a list of candidate books and a byte excess,
 * returns the minimum set of book IDs to evict (oldest/largest first)
 * that covers the excess.
 */
export function selectEvictionCandidates(candidates, excessBytes) {
  const selected = [];
  let freed = 0;
  for (const book of candidates) {
    if (freed >= excessBytes) break;
    selected.push(book.id);
    freed += book.size || 0;
  }
  return selected;
}
