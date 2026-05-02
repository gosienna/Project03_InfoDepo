/**
 * Safari / WebKit often throws WebKitBlobResource error when FormData/fetch reads a Blob
 * still backed by IndexedDB. Materialize into a normal RAM-backed Blob for uploads.
 * @param {Blob|File} blobLike
 * @param {string} [mimeTypeHint]
 * @returns {Promise<Blob>}
 */
export async function cloneBlobForNetwork(blobLike, mimeTypeHint) {
  if (blobLike == null) return blobLike;
  const type = mimeTypeHint || blobLike.type || 'application/octet-stream';
  if (typeof blobLike.arrayBuffer === 'function') {
    const buf = await blobLike.arrayBuffer();
    return new Blob([buf], { type });
  }
  return blobLike;
}
