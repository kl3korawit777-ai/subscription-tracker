// Service worker: ให้แอปเปิดใช้งานออฟไลน์ได้ — แก้ไฟล์แอปแล้วให้เพิ่มเลข CACHE_VERSION
const CACHE_VERSION = 'v14';
const CACHE = `subs-${CACHE_VERSION}`;
const SHELL = [
  './', 'css/style.css', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/Anuphan.ttf',
  'js/app.js', 'js/storage.js', 'js/recurrence.js', 'js/calendar.js', 'js/dashboard.js', 'js/ics.js', 'js/ledger.js', 'js/firebase.js', 'js/firebase-config.js', 'js/syncstate.js', 'js/settings.js', 'js/storage.idb.js', 'js/storage.firestore.js', 'js/migrate.js', 'js/analytics.js', 'js/summaryText.js', 'js/charts.js', 'js/trash.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // SDK ของ Firebase (ไฟล์ตามเวอร์ชัน ไม่เปลี่ยน): cache-first เพื่อให้เปิดแอปตอนออฟไลน์ได้หลังเคยโหลดแล้ว
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (!sameOrigin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(req, { ignoreSearch: true })) ?? (req.mode === 'navigate' ? await cache.match('./') : undefined);
    // ไฟล์แอป: stale-while-revalidate (เปิดเร็ว/ออฟไลน์ได้ และอัปเดตเงียบ ๆ รอบถัดไป)
    const refresh = fetch(req).then((res) => {
      if (res.ok && !res.redirected) cache.put(req, res.clone());
      return res;
    });
    if (cached) {
      refresh.catch(() => {});
      return cached;
    }
    try { return await refresh; } catch { return Response.error(); }
  })());
});
