/**
 * Download shared content from peer owners by walking their _infodepo_index.json files.
 */
import { fetchOwnerIndex } from './ownerIndex.js';
import { listPeerUsers } from './userConfig.js';
import { CHANNEL_JSON_MARKER } from './driveSync.js';

/**
 * For each peer user in config, fetch their index and download items shared with myEmail.
 * @returns {{ added: number, updated: number, skipped: number, removed: number, failed: number }}
 */
export async function syncSharedFromPeers({
  accessToken,
  myEmail,
  config,
  getBookByDriveId,
  upsertDriveBook,
  getChannelByDriveId,
  upsertDriveChannel,
  getLocalRecordsByOwnerEmail,
  deleteItemByDriveId,
  deleteChannelByDriveId,
  onProgress,
}) {
  const progress = onProgress || (() => {});
  const counts = { added: 0, updated: 0, skipped: 0, removed: 0, failed: 0 };
  const me = (myEmail || '').trim().toLowerCase();
  if (!me) return counts;

  const peers = listPeerUsers(me, config);
  if (!peers.length) return counts;

  for (const peer of peers) {
    progress(`Checking shared content from ${peer.email}…`);
    console.log('[InfoDepo][peerSync] checking owner index', {
      peerEmail: peer.email,
      peerRole: peer.role,
      folderId: peer.folderId,
    });
    let index;
    try {
      index = await fetchOwnerIndex({
        accessToken,
        folderId: peer.folderId,
        expectedOwnerEmail: peer.email,
      });
    } catch {
      console.warn('[InfoDepo][peerSync] failed to fetch owner index', {
        peerEmail: peer.email,
        folderId: peer.folderId,
      });
      continue;
    }
    if (!index || !Array.isArray(index.items)) {
      console.log('[InfoDepo][peerSync] owner index missing or unreadable', {
        peerEmail: peer.email,
        folderId: peer.folderId,
      });
      continue;
    }

    const sharedWithMe = index.items.filter(
      (entry) => Array.isArray(entry.sharedWith) && entry.sharedWith.includes(me)
    );
    const sharedDriveIds = new Set(
      sharedWithMe.map((entry) => String(entry.driveId || '').trim()).filter(Boolean)
    );
    console.log('[InfoDepo][peerSync] owner index loaded', {
      peerEmail: peer.email,
      totalItemsInIndex: index.items.length,
      sharedWithMeCount: sharedWithMe.length,
      me,
    });
    if (getLocalRecordsByOwnerEmail && deleteItemByDriveId && deleteChannelByDriveId) {
      try {
        const localOwned = await getLocalRecordsByOwnerEmail(peer.email);
        for (const localItem of localOwned.items || []) {
          const localDriveId = String(localItem?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          const removed = await deleteItemByDriveId(localDriveId);
          if (removed) counts.removed++;
        }
        for (const localChannel of localOwned.channels || []) {
          const localDriveId = String(localChannel?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          const removed = await deleteChannelByDriveId(localDriveId);
          if (removed) counts.removed++;
        }
      } catch (pruneErr) {
        console.warn('[InfoDepo][peerSync] prune removed-share records failed', {
          peerEmail: peer.email,
          error: pruneErr?.message || String(pruneErr),
        });
      }
    }

    for (const entry of sharedWithMe) {
      const driveId = String(entry.driveId || '').trim();
      if (!driveId) continue;

      progress(`Downloading ${entry.name} from ${peer.email}…`);

      try {
        const metaRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!metaRes.ok) {
          console.warn(`[peerSync] file not accessible (HTTP ${metaRes.status}) — driveId: ${driveId}, owner: ${peer.email}, name: ${entry.name}. The owner may need to re-grant Drive sharing permissions.`);
          counts.failed++;
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

        if (entry.type === 'infodepo-channel' && upsertDriveChannel) {
          const existing = await getChannelByDriveId(driveId);
          const driveIsNewer = existing
            ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
            : true;
          if (existing && !driveIsNewer) { counts.skipped++; continue; }

          const blobRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!blobRes.ok) { counts.failed++; continue; }
          const text = await blobRes.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed._type === CHANNEL_JSON_MARKER && parsed.channelId) {
              const { _type, ...channelData } = parsed;
              channelData.ownerEmail = peer.email;
              const action = await upsertDriveChannel(driveFile, channelData, { silent: true });
              if (action === 'added') counts.added++;
              else if (action === 'updated') counts.updated++;
              else counts.skipped++;
              continue;
            }
          } catch { /* fall through */ }
          counts.skipped++;
          continue;
        }

        const existing = await getBookByDriveId(driveId);
        const driveIsNewer = existing
          ? !existing.modifiedTime || new Date(driveFile.modifiedTime) > new Date(existing.modifiedTime)
          : true;
        if (existing && !driveIsNewer) { counts.skipped++; continue; }

        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) { counts.failed++; continue; }
        let blob = await blobRes.blob();
        let effectiveFile = driveFile;

        if (driveFile.mimeType === 'application/json') {
          try {
            const text = await blob.text();
            const parsed = JSON.parse(text);
            if (parsed.url && /youtube\.com|youtu\.be/.test(parsed.url)) {
              const safeTitle = (parsed.title || 'YouTube Video').replace(/[/\\?%*:|"<>]/g, '-');
              effectiveFile = { ...driveFile, name: safeTitle + '.youtube', mimeType: 'application/x-youtube' };
              blob = new Blob([text], { type: 'application/x-youtube' });
            }
          } catch { /* not valid JSON */ }
        }

        effectiveFile.ownerEmail = peer.email;
        const action = await upsertDriveBook(effectiveFile, blob, undefined, { silent: true });
        if (action === 'added') counts.added++;
        else if (action === 'updated') counts.updated++;
        else counts.skipped++;
      } catch (err) {
        console.warn(`[peerSync] failed for ${entry.name} from ${peer.email}:`, err);
        counts.failed++;
      }
    }
  }

  progress('');
  return counts;
}
