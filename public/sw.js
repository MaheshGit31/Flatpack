/* Flatpak service worker: makes the app (shell, fonts, wasm, OCR files, demo data) available with the network fully off.
   - same-origin GET: cache-first, filled on first use, plus an explicit precache list (precache.json) the page can request.
   - navigations fall back to the cached index.html when the network is down.
   - "airplane mode (simulated)": while on, EVERY request from this app (any origin) is refused by this worker, so the demo can prove
     offline operation even on a machine that still has wifi. Real airplane mode needs nothing special.
   Models are cached by transformers.js itself in Cache Storage ("transformers-cache"), which is read without any network request. */
const BUILD = '__BUILD_ID__';
const RT = `flatpak-rt-${BUILD}`;
const STATE = 'flatpak-state';
const STATE_URL = '/__flatpak_airplane';

async function airplane() {
  try { return !!(await (await caches.open(STATE)).match(STATE_URL)); } catch { return false; }
}
async function setAirplane(on) {
  const c = await caches.open(STATE);
  if (on) await c.put(STATE_URL, new Response('1')); else await c.delete(STATE_URL);
  const all = await self.clients.matchAll({ includeUncontrolled: true });
  for (const cl of all) cl.postMessage({ type: 'airplane', on });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('flatpak-rt-') && k !== RT) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'airplane') e.waitUntil(setAirplane(!!m.on).then(() => e.ports[0] && e.ports[0].postMessage({ ok: true })));
  else if (m.type === 'airplane?') e.waitUntil(airplane().then((on) => e.ports[0] && e.ports[0].postMessage({ on })));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const off = await airplane();
    const url = new URL(req.url);
    const same = url.origin === self.location.origin;
    if (!same) return off ? Response.error() : fetch(req);
    const cache = await caches.open(RT);
    const nav = req.mode === 'navigate';
    const key = nav ? new Request(new URL('./', self.registration.scope).href) : req;
    const hit = await cache.match(key, { ignoreSearch: nav });
    if (off) return hit || Response.error();
    if (nav) {
      try { const r = await fetch(req); if (r.ok) cache.put(key, r.clone()); return r; } catch { return hit || Response.error(); }
    }
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok && r.status === 200) cache.put(req, r.clone());
    return r;
  })());
});
