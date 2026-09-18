/* 账本 Service Worker
 *
 * 策略（只管静态壳，绝不动业务数据）：
 * - 导航请求（打开/刷新页面）：network-first —— 优先拿最新版 index.html，
 *   断网时回退到缓存。这样发新版后用户刷新一次就能拿到，不会被困在旧版。
 * - 同源静态资源（图标/manifest）：cache-first，基本不变，缓存命中就不再发请求。
 * - 其余请求（API、AI 服务等跨域调用）：直接透传，一个字节都不缓存。
 *   记账数据必须以服务端为准，缓存会造成「看到的是旧账」这种极难排查的问题。
 *
 * 版本号 CACHE_VERSION 变了才会重新 precache 并在 activate 时清掉旧缓存。
 * 发新版时改这里即可。
 */
const CACHE_VERSION = 'ledger-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 只拦 GET：API 的 POST/DELETE 等写操作必须直达网络
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域（如 AI 服务）不碰
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 顺手更新缓存的壳，下次断网打开就是新版
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
