/**
 * pdfjs-dist 5.x calls Map.prototype.getOrInsertComputed (ES2024); Safari / WebKit
 * before ~18.2 omit it. Install once per JS realm (window, Worker).
 */
if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value: function getOrInsertComputed(key, callbackfn) {
      if (typeof callbackfn !== 'function') {
        throw new TypeError('Map.prototype.getOrInsertComputed: callback must be a function');
      }
      if (this.has(key)) return this.get(key);
      const v = callbackfn.call(undefined, key);
      this.set(key, v);
      return v;
    },
  });
}
