const CACHE_NAME = 'studio-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 安装时缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 网络请求策略：先网络，失败则缓存
self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;
  
  // 图片用缓存优先策略
  if (event.request.destination === 'image') {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request)
          .then(response => {
            // 缓存新图片
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => 
              cache.put(event.request, clone)
            );
            return response;
          })
        )
    );
    return;
  }
  
  // 其他资源用网络优先策略
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => 
          cache.put(event.request, clone)
        );
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
