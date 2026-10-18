// 离线缓存应用文件。改了下面任一文件后，把版本号加 1，用户下次打开时更新。
const CACHE = 'closet-v28';
const FILES = [
  './', 'index.html', 'app.js', 'store.js', 'image.js', 'options.js', 'style.css',
  'config.js', 'queue.js', 'backup.js', 'picker.js', 'outfit.js', 'thumbs.js', 'layout.js', 'week.js', 'model-worker.js', 'taxonomy.js', 'label-embeddings.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  // 本站的 transformers.js 和 ONNX Runtime（见 config.js VENDOR）
  'vendor/transformers-4.3.1/transformers.min.js',
  'vendor/transformers-4.3.1/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/transformers-4.3.1/ort-wasm-simd-threaded.asyncify.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 只处理应用文件：缓存优先，同时后台更新缓存。spike/ 和其他请求直接走网络
const APP_URLS = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.searchParams.has('net')) return; // 诊断页 check.html：直接走网络
  url.search = '';
  if (e.request.method !== 'GET' || !APP_URLS.has(url.href)) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    if (cached) { fresh.catch(() => {}); return cached; }
    return fresh;
  }));
});
