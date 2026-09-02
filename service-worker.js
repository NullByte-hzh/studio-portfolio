const CACHE_NAME = 'studio-v5';
// 资源清单；在 install 事件内基于 registration.scope 计算绝对地址，
// 兼容根目录与 GitHub Pages 子路径部署（顶层访问 self.registration 会导致 worker 失效）
const ASSET_PATHS = ['.', 'index.html', 'manifest.json', 'icon-192.svg'];

// 安装时逐个缓存核心资源，单个失败不会中断安装
self.addEventListener('install', event => {
  const assets = ASSET_PATHS.map(p => new URL(p, self.registration.scope).href);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(assets.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function cachePut(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (e) {
    // 缓存失败不影响页面请求
  }
}

// 图片：缓存优先，失败才走网络
async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
      cachePut(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// 其他请求：网络优先，失败回退缓存；导航请求回退到应用外壳
async function networkFirst(request, isNavigate) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cachePut(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isNavigate) {
      const shell = await caches.match(new URL('index.html', self.registration.scope).href);
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request, event.request.mode === 'navigate'));
});
