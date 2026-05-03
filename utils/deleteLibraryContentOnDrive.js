import { deleteDriveFile } from './driveDeleteFile.js';

const isMarkdownType = (type) =>
  type != null && String(type).trim() === 'text/markdown';

/**
 * Deletes the Drive file for a library item and, for Markdown notes, any embedded images that were uploaded.
 * @param {string} accessToken
 * @param {object} item — merged library row (books / notes / videos)
 * @param {(noteId: number) => Promise<object[]>} [getImagesForNote]
 */
export async function deleteDriveFilesForMergedItem(accessToken, item, getImagesForNote) {
  const seen = new Set();
  const queue = [];

  const push = (id) => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    queue.push(s);
  };

  if (isMarkdownType(item?.type) && item?.driveFolderId) {
    // Deleting the folder cascades to the .md file and all asset files inside it.
    push(item.driveFolderId);
  } else {
    push(item?.driveId);

    // Legacy: notes without a folder — delete the .md file plus any individually-uploaded images.
    if (isMarkdownType(item?.type) && item?.id != null && typeof getImagesForNote === 'function') {
      try {
        const imgs = await getImagesForNote(item.id);
        for (const im of imgs || []) push(im?.driveId);
      } catch (e) {
        console.warn('[InfoDepo] getImagesForNote while deleting from Drive:', e);
      }
    }
  }

  for (const fileId of queue) {
    await deleteDriveFile(accessToken, fileId);
  }
}

/**
 * @param {string} accessToken
 * @param {object} channel
 */
export async function deleteDriveFilesForChannel(accessToken, channel) {
  await deleteDriveFile(accessToken, String(channel?.driveId || '').trim());
}

/**
 * @param {string} accessToken
 * @param {object} desk
 */
export async function deleteDriveFilesForDesk(accessToken, desk) {
  await deleteDriveFile(accessToken, String(desk?.driveId || '').trim());
}
