/**
 * Download shared content from peer owners by walking their _infodepo_index.json files.
 */
import { fetchOwnerIndex } from './ownerIndex.js';
import { listPeerUsers } from './userConfig.js';
import { CHANNEL_JSON_MARKER } from './driveSync.js';

/**
 * For each peer user in config, fetch their index and download items shared with myEmail.
 * Two-phase: first fetch all indices to compute a global total, then download with X/N progress.
 *
 * Index modifiedTime is used directly for the freshness check — no per-item Drive metadata
 * fetch is needed. The owner always writes the index after backup, so the index timestamps
 * are at least as fresh as the Drive files.
 *
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
  getDeskByDriveId,
  upsertDriveDesk,
  getLocalRecordsByOwnerEmail,
  deleteItemByDriveId,
  deleteChannelByDriveId,
  deleteDeskByDriveId,
  upsertDriveCoverImage,
  onProgress,
  lazyBooks = false,
  onBatchComplete,
}) {
  const progress = onProgress || (() => {});
  const counts = { added: 0, updated: 0, skipped: 0, removed: 0, failed: 0 };
  let globalProcessed = 0;
  const batchTick = () => {
    globalProcessed++;
    if (onBatchComplete && globalProcessed % 20 === 0) onBatchComplete();
  };
  const me = (myEmail || '').trim().toLowerCase();
  if (!me) return counts;

  const peers = listPeerUsers(me, config);
  console.log('[InfoDepo][peerSync] peers with folderId:', peers.map(p => ({ email: p.email, folderId: p.folderId })));
  if (!peers.length) {
    console.warn('[InfoDepo][peerSync] no peers found — owner folderId not set in config');
    return counts;
  }

  const truncate = (str, max = 28) => {
    const s = String(str || '');
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  };

  const sameEmailSet = (a = [], b = []) => {
    const norm = (arr) =>
      [...new Set((arr || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))].sort();
    const sa = norm(a);
    const sb = norm(b);
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  };

  // Phase 1: fetch all peer indices to compute global total before any downloads start.
  progress('Fetching shared content index…');
  const peerData = [];
  for (const peer of peers) {
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

    peerData.push({ peer, sharedWithMe, sharedDriveIds });
  }

  const globalTotal = peerData.reduce((sum, p) => sum + p.sharedWithMe.length, 0);
  let globalIdx = 0;

  // Phase 2: prune removed items then download, showing a unified X / N counter.
  for (const { peer, sharedWithMe, sharedDriveIds } of peerData) {
    if (getLocalRecordsByOwnerEmail && deleteItemByDriveId && deleteChannelByDriveId) {
      try {
        const localOwned = await getLocalRecordsByOwnerEmail(peer.email);
        let toRemove = 0;
        for (const localItem of localOwned.items || []) {
          const localDriveId = String(localItem?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          toRemove++;
        }
        for (const localChannel of localOwned.channels || []) {
          const localDriveId = String(localChannel?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          toRemove++;
        }
        for (const localDesk of localOwned.desks || []) {
          const localDriveId = String(localDesk?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          toRemove++;
        }
        if (toRemove > 0) {
          progress(`Removing ${toRemove} item${toRemove !== 1 ? 's' : ''} no longer shared…`);
        }
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
        for (const localDesk of localOwned.desks || []) {
          const localDriveId = String(localDesk?.driveId || '').trim();
          if (!localDriveId || sharedDriveIds.has(localDriveId)) continue;
          if (deleteDeskByDriveId) {
            const removed = await deleteDeskByDriveId(localDriveId);
            if (removed) counts.removed++;
          }
        }
      } catch (pruneErr) {
        console.warn('[InfoDepo][peerSync] prune removed-share records failed', {
          peerEmail: peer.email,
          error: pruneErr?.message || String(pruneErr),
        });
      }
    }

    for (const entry of sharedWithMe) {
      globalIdx++;
      const driveId = String(entry.driveId || '').trim();
      if (!driveId) continue;
      const normalizedSharedWith = Array.isArray(entry.sharedWith)
        ? entry.sharedWith.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
        : [];

      try {
        progress(`${globalIdx} / ${globalTotal}`);
        console.log(`[InfoDepo][peerSync] (${globalIdx}/${globalTotal}) checking "${entry.name}" driveId=${driveId} type=${entry.type || 'item'}`);

        if (entry.type === 'infodepo-channel' && upsertDriveChannel) {
          const existing = await getChannelByDriveId(driveId);
          const driveIsNewer = !existing
            ? true
            : !existing.modifiedTime || new Date(entry.modifiedTime) > new Date(existing.modifiedTime);
          const sharedWithChanged = !existing || !sameEmailSet(existing.sharedWith, normalizedSharedWith);
          if (existing && !driveIsNewer && !sharedWithChanged) {
            console.log(`[InfoDepo][peerSync] skipping channel "${entry.name}" (up to date)`);
            counts.skipped++; batchTick(); continue;
          }

          const blobRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!blobRes.ok) {
            console.warn(`[InfoDepo][peerSync] channel blob FAILED (${blobRes.status}) for "${entry.name}"`);
            counts.failed++; batchTick(); continue;
          }
          const text = await blobRes.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed._type === CHANNEL_JSON_MARKER && parsed.channelId) {
              const { _type, ...channelData } = parsed;
              channelData.ownerEmail = peer.email;
              channelData.sharedWith = normalizedSharedWith;
              const driveFile = { driveId, name: entry.name, mimeType: 'application/json', modifiedTime: entry.modifiedTime };
              const action = await upsertDriveChannel(driveFile, channelData, { silent: true });
              console.log(`[InfoDepo][peerSync] channel "${entry.name}" → ${action}`);
              if (action === 'added') counts.added++;
              else if (action === 'updated') counts.updated++;
              else counts.skipped++;
              batchTick(); continue;
            }
          } catch { /* fall through */ }
          counts.skipped++;
          batchTick(); continue;
        }

        if (entry.type === 'infodepo-desk' && upsertDriveDesk) {
          const existing = getDeskByDriveId ? await getDeskByDriveId(driveId) : undefined;
          const driveIsNewer = !existing
            ? true
            : !existing.modifiedTime || new Date(entry.modifiedTime) > new Date(existing.modifiedTime);
          const sharedWithChanged = !existing || !sameEmailSet(existing.sharedWith, normalizedSharedWith);
          if (existing && !driveIsNewer && !sharedWithChanged) { counts.skipped++; batchTick(); continue; }

          const blobRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!blobRes.ok) { counts.failed++; batchTick(); continue; }
          try {
            const parsed = JSON.parse(await blobRes.text());
            if (parsed._type === 'infodepo-desk') {
              const { _type, ...deskData } = parsed;
              deskData.ownerEmail = peer.email;
              deskData.sharedWith = normalizedSharedWith;
              const driveFile = { driveId, name: entry.name, mimeType: 'application/json', modifiedTime: entry.modifiedTime };
              const action = await upsertDriveDesk(driveFile, deskData, { silent: true });
              if (action === 'added') counts.added++;
              else if (action === 'updated') counts.updated++;
              else counts.skipped++;
              batchTick(); continue;
            }
          } catch { /* fall through */ }
          counts.skipped++;
          batchTick(); continue;
        }

        // Books, notes, YouTube videos
        const existing = await getBookByDriveId(driveId);
        const driveIsNewer = !existing
          ? true
          : !existing.modifiedTime || new Date(entry.modifiedTime) > new Date(existing.modifiedTime);
        const sharedWithChanged = !existing || !sameEmailSet(existing.sharedWith, normalizedSharedWith);
        if (existing && !driveIsNewer && !sharedWithChanged) {
          console.log(`[InfoDepo][peerSync] skipping "${entry.name}" (up to date, hasData=${!!existing.data})`);
          counts.skipped++; batchTick(); continue;
        }

        const isYoutube = entry.type === 'application/x-youtube';
        const isMarkdown = entry.type === 'text/markdown';
        const isJson = !isMarkdown && !isYoutube && entry.type === 'application/json';
        const isBinary = !isMarkdown && !isYoutube && !isJson;

        // Binary books: in lazy mode save metadata only and skip the blob download.
        // JSON must still download so we can detect YouTube entries.
        if (lazyBooks && isBinary) {
          const effectiveFile = {
            driveId,
            name: entry.name,
            mimeType: entry.type,
            size: entry.size || 0,
            modifiedTime: entry.modifiedTime,
            ownerEmail: peer.email,
            sharedWith: normalizedSharedWith,
            tags: Array.isArray(entry.tags) ? entry.tags : [],
          };
          const action = await upsertDriveBook(effectiveFile, null, undefined, { silent: true });
          console.log(`[InfoDepo][peerSync] lazy book "${entry.name}" (${entry.type}) → ${action}`);
          if (action === 'added') counts.added++;
          else if (action === 'updated') counts.updated++;
          else counts.skipped++;
          if (entry.coverImageDriveId && upsertDriveCoverImage) {
            try {
              const coverBlob = await fetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.coverImageDriveId)}?alt=media`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              ).then((r) => r.ok ? r.blob() : null);
              if (coverBlob) {
                const coverMetaRes = await fetch(
                  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.coverImageDriveId)}?fields=id,name,mimeType,modifiedTime`,
                  { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (coverMetaRes.ok) {
                  const cm = await coverMetaRes.json();
                  await upsertDriveCoverImage({
                    driveId: cm.id, parentItemName: entry.name, mimeType: cm.mimeType, modifiedTime: cm.modifiedTime,
                  }, coverBlob);
                }
              }
            } catch (coverErr) {
              console.warn(`[peerSync] cover sidecar failed for ${entry.name}:`, coverErr);
            }
          }
          batchTick(); continue;
        }

        const blobRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!blobRes.ok) {
          console.warn(`[InfoDepo][peerSync] blob FAILED (${blobRes.status}) for "${entry.name}"`);
          counts.failed++; batchTick(); continue;
        }
        let blob = await blobRes.blob();
        let effectiveFile = {
          driveId,
          name: entry.name,
          mimeType: entry.type,
          size: entry.size || 0,
          modifiedTime: entry.modifiedTime,
          ownerEmail: peer.email,
          sharedWith: normalizedSharedWith,
          tags: Array.isArray(entry.tags) ? entry.tags : [],
        };

        if (isYoutube || isJson) {
          try {
            const text = await blob.text();
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

        const action = await upsertDriveBook(effectiveFile, blob, undefined, { silent: true });
        console.log(`[InfoDepo][peerSync] full download "${effectiveFile.name}" (${effectiveFile.mimeType}) → ${action}`);
        if (action === 'added') counts.added++;
        else if (action === 'updated') counts.updated++;
        else counts.skipped++;

        if (entry.coverImageDriveId && upsertDriveCoverImage) {
          try {
            const coverBlob = await fetch(
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.coverImageDriveId)}?alt=media`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            ).then((r) => r.ok ? r.blob() : null);
            if (coverBlob) {
              const coverMetaRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.coverImageDriveId)}?fields=id,name,mimeType,modifiedTime`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (coverMetaRes.ok) {
                const cm = await coverMetaRes.json();
                await upsertDriveCoverImage({
                  driveId: cm.id, parentItemName: entry.name, mimeType: cm.mimeType, modifiedTime: cm.modifiedTime,
                }, coverBlob);
              }
            }
          } catch (coverErr) {
            console.warn(`[peerSync] cover sidecar failed for ${entry.name}:`, coverErr);
          }
        }
        batchTick();
      } catch (err) {
        console.warn(`[InfoDepo][peerSync] exception for "${entry.name}" from ${peer.email}:`, err?.message || err);
        counts.failed++;
        batchTick();
      }
    }
    console.log(`[InfoDepo][peerSync] peer ${peer.email} done — added=${counts.added} updated=${counts.updated} skipped=${counts.skipped} failed=${counts.failed}`);
  }

  return counts;
}
