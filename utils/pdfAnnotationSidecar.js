/**
 * PDF annotation sidecar: JSON synced to Drive separately from the PDF bytes.
 * Drive file name: `${pdfFileName}.infodepo-annotations.json`
 */
export const PDF_ANNOTATION_JSON_MARKER = 'infodepo-pdf-annotations';
export const PDF_ANNOTATION_FILENAME_SUFFIX = '.infodepo-annotations.json';

export function pdfAnnotationSidecarFileName(pdfFileName) {
  const base = String(pdfFileName || 'document.pdf').trim() || 'document.pdf';
  return `${base}${PDF_ANNOTATION_FILENAME_SUFFIX}`;
}

export function isPdfAnnotationSidecarFilename(name) {
  return typeof name === 'string' && name.endsWith(PDF_ANNOTATION_FILENAME_SUFFIX);
}

/**
 * @param {object} opts
 * @param {string} opts.pdfDriveId
 * @param {number} opts.itemId
 * @param {string} opts.idbStore
 * @param {Array} opts.annotations
 * @returns {string}
 */
export function serializePdfAnnotationSidecar({ pdfDriveId, itemId, idbStore, annotations }) {
  return JSON.stringify({
    _type: PDF_ANNOTATION_JSON_MARKER,
    version: 1,
    pdfDriveId: String(pdfDriveId || ''),
    itemId: Number(itemId) || 0,
    idbStore: String(idbStore || 'books'),
    updatedAt: new Date().toISOString(),
    annotations: Array.isArray(annotations) ? annotations : [],
  });
}

export function parsePdfAnnotationSidecarText(text) {
  try {
    const o = JSON.parse(text);
    if (o && o._type === PDF_ANNOTATION_JSON_MARKER && o.pdfDriveId) return o;
  } catch {
    /* ignore */
  }
  return null;
}

export function timeMs(t) {
  if (t == null) return null;
  if (t instanceof Date) {
    const x = t.getTime();
    return Number.isNaN(x) ? null : x;
  }
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** True when local sidecar edits should be uploaded to Drive. */
export function pdfAnnotationSidecarNeedsBackup(sidecar) {
  if (!sidecar) return false;
  const ad = String(sidecar.annotationDriveId || '').trim();
  if (!ad) return true;
  const lm = timeMs(sidecar.localModifiedAt);
  const mt = timeMs(sidecar.modifiedTime);
  if (lm == null) return false;
  if (mt == null) return true;
  return lm > mt;
}
