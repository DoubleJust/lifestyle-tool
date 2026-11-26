// Service worker：只快取 App 外殼（HTML/CSS/JS/圖示/靜態 JSON）。
// API（Apps Script，跨網域）一律不經過這裡，永遠走網路。
// 改版時執行 `node tools/bump-version.mjs`，會同時更新這裡和 js/config.js。

const CACHE_VERSION = '1.5.1';
const CACHE_NAME = `shell-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/config.js',
  './js/api.js',
  './js/store.js',
  './js/ui.js',
  './js/sw-client.js',
  './js/health.js',
  './js/lib/health.js',
  './js/lib/rewards.js',
  './js/lib/events.js',
  './js/lib/eventcache.js',
  './data/cards.json',
  './data/rewards.json',
  './data/merchants.json',
  './js/pages/cards.js',
  './js/pages/flights.js',
  './js/pages/events.js',
  './js/pages/places.js',
  './js/pages/settings.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' 確保抓到最新檔案，不吃 GitHub Pages 的 HTTP 快取
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // 不自動 skipWaiting：等使用者在提示列按「重新載入」，避免新舊檔案混用
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API 與外部資源：不攔截

  // 開啟頁面：先用快取的外殼，離線也能打開
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./index.html', { cacheName: CACHE_NAME });
      const isShellPage = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
      if (cached && isShellPage) return cached;
      // 其他頁面（例如 poc.html）走網路，離線時退回外殼
      try { return await fetch(req); } catch { return cached || Response.error(); }
    })());
    return;
  }

  // 其他同網域檔案：快取優先，沒有才走網路（例如 poc.html）
  event.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE_NAME, ignoreSearch: true });
    return cached || fetch(req);
  })());
});
