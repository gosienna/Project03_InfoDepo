/**
 * Polyfills for pdfjs-dist compatibility.
 *
 * pdfjs-dist 4.x: no polyfills required — kept as a no-op import so the worker
 * entry and PdfViewer can continue to import this file without changes.
 *
 * If upgrading to pdfjs-dist 5.x again, restore:
 *   - Map.prototype.getOrInsertComputed  (ES2024, missing in Safari < 18.2)
 *   - ReadableStream.prototype[Symbol.asyncIterator]  (missing in Safari < 17.4)
 */
