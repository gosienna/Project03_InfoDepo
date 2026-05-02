/**
 * foliate-js revokes blob: URLs when leaving an EPUB spine item (Loader.unref).
 * WebKit often still has iframe/subresource work in flight; immediate revoke
 * surfaces as "WebKitBlobResource error 1" and can crash the tab after paging.
 * Defer revoke slightly on Apple platforms (Safari, all iOS browsers).
 */
(function installDeferredBlobUrlRevoke() {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const touchMac = typeof navigator !== 'undefined'
    && navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1;
  const appleMobile = /iPhone|iPad|iPod/i.test(ua) || touchMac;
  const desktopSafari = /Macintosh/i.test(ua) && /Safari/i.test(ua)
    && !/Chrome|Chromium|Edg|Firefox|FxiOS/i.test(ua);
  if (!appleMobile && !desktopSafari) return;

  const native = URL.revokeObjectURL.bind(URL);
  const DELAY_MS = 1500;
  const timers = new Map();

  URL.revokeObjectURL = function revokeObjectURLDeferred(href) {
    if (href == null || href === '') {
      try { native(href); } catch (_) { /* ignore */ }
      return;
    }
    const prev = timers.get(href);
    if (prev != null) clearTimeout(prev);
    timers.set(
      href,
      setTimeout(() => {
        timers.delete(href);
        try { native(href); } catch (_) { /* ignore */ }
      }, DELAY_MS),
    );
  };
})();
