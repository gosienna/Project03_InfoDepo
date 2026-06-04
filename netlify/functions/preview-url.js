/**
 * Preview proxy — fetches a remote URL and serves the HTML directly as text/html.
 * Used by the Explorer iframe so the content loads from our own origin, bypassing
 * the target site's X-Frame-Options / CSP frame-ancestors restrictions.
 *
 * A <base> tag is injected so relative assets (CSS, images) still resolve from
 * the original domain.  X-Frame-Options is deliberately omitted from our response.
 */
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  let url;
  try {
    url = params.u ? decodeURIComponent(params.u) : null;
  } catch {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Invalid u parameter' };
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Missing or invalid URL' };
  }

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: `Fetch failed: ${e.message}` };
  }

  if (!res.ok) {
    return { statusCode: res.status, headers: { 'Content-Type': 'text/plain' }, body: `Target returned ${res.status}` };
  }

  let html = await res.text();
  const finalUrl = res.url;

  // Inject <base> so relative paths (CSS, images, links) resolve from the original domain.
  // Patch history.replaceState/pushState on the prototype — proxied pages' JS (e.g.
  // Next.js router) resolves URLs against the <base> domain and passes cross-origin
  // URLs to replaceState, which throws SecurityError.  We rewrite those URLs to
  // same-origin paths and fall back to a silent catch.
  const historyPatch = `<script>
(function(){
  var o=window.location.origin;
  function f(u){
    if(!u)return u;
    try{var p=new URL(u,window.location.href);if(p.origin!==o)return p.pathname+p.search+p.hash}catch(e){}
    return u;
  }
  var R=History.prototype.replaceState,P=History.prototype.pushState;
  History.prototype.replaceState=function(s,t,u){try{R.call(this,s,t,f(u))}catch(e){}};
  History.prototype.pushState=function(s,t,u){try{P.call(this,s,t,f(u))}catch(e){}};
})();
</script>`;
  const baseTag = `<base href="${finalUrl}">`;
  html = html.replace(/(<head[^>]*>)/i, `$1${historyPatch}${baseTag}`);

  // Return as HTML from our origin — we intentionally do NOT forward X-Frame-Options
  // or Content-Security-Policy frame-ancestors from the upstream response.
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    body: html,
  };
};
