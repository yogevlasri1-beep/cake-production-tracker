/* Service Worker — offline: מטמון קודם ל-shell, רשת ברקע לעדכונים */
const VERSION = '342';
const CACHE = `yitzur-v${VERSION}`;

function v(path) {
  return /\.(js|css)$/i.test(path) ? `${path}?v=${VERSION}` : path;
}

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  v('./css/styles.css'),
  v('./js/vendor/dexie.min.js'),
  v('./js/vendor/chart.umd.min.js'),
  v('./js/vendor/xlsx.full.min.js'),
  v('./js/vendor/fflate.min.js'),
  v('./js/app.js'),
  v('./js/version.js'),
  v('./js/db.js'),
  v('./js/utils.js'),
  v('./js/calc.js'),
  v('./js/validators.js'),
  v('./js/network.js'),
  v('./js/export.js'),
  v('./js/report-page-export.js'),
  v('./js/daily-plan-export.js'),
  v('./js/import.js'),
  v('./js/import-flow.js'),
  v('./js/download.js'),
  v('./js/xlsx-loader.js'),
  v('./js/backup.js'),
  v('./js/backup-service.js'),
  v('./js/supabase-backup.js'),
  v('./js/backup-folder-bridge.js'),
  v('./js/backup-folder-web.js'),
  v('./js/sheets-flow.js'),
  v('./js/google-sheets.js'),
  v('./js/integrity.js'),
  v('./js/chart.js'),
  v('./js/modal.js'),
  v('./js/ios-install.js'),
  v('./js/sw-register.js'),
  v('./js/product-drag.js'),
  v('./js/workspaces.js'),
  v('./js/kitchen-db.js'),
  v('./js/purchasing-db.js'),
  v('./js/portion-ingredients.js'),
  v('./js/recipes-portions.js'),
  v('./js/recipes-machines.js'),
  v('./js/ratio-print.js'),
  v('./js/baking-print.js'),
  v('./js/docx-loader.js'),
  v('./js/recipe-import.js'),
  v('./js/supplier-import.js'),
  v('./js/screens/home.js'),
  v('./js/screens/process.js'),
  v('./js/screens/products.js'),
  v('./js/screens/manager.js'),
  v('./js/screens/targets.js'),
  v('./js/screens/reports.js'),
  v('./js/screens/backup.js'),
  v('./js/screens/recipes.js'),
  v('./js/screens/suppliers.js'),
  v('./js/screens/purchasing.js'),
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW precache partial fail', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function cacheKey(url) {
  const u = new URL(url);
  if (/\.(js|css)$/i.test(u.pathname)) {
    const ver = u.searchParams.get('v');
    u.search = ver ? `?v=${ver}` : '';
  } else {
    u.search = '';
  }
  return u.toString();
}

async function matchCached(request) {
  let hit = await caches.match(request);
  if (hit) return hit;
  return caches.match(cacheKey(request.url));
}

async function putInCache(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.mode === 'navigate') return;
  if (path.endsWith('index.html') || path.endsWith('version.js') || path.endsWith('sw.js')) return;
  const cache = await caches.open(CACHE);
  await cache.put(cacheKey(request.url), response.clone());
}

function isAppShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname;
  return /\.(js|css|json|png|webp|svg|woff2?)$/i.test(path)
    || path.endsWith('/')
    || path.endsWith('/index.html');
}

async function refreshInBackground(request) {
  try {
    const response = await fetch(request);
    await putInCache(request, response);
  } catch {
    /* offline — ignore */
  }
}

function mustNetworkFirst(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname;
  if (path.endsWith('index.html') || path.endsWith('/') || path.endsWith('sw.js')) return true;
  if (path.endsWith('version.js')) return true;
  if (/\.(js|css)$/i.test(path)) return true;
  if (url.searchParams.has('_') || url.searchParams.has('check') || url.searchParams.has('gate')
    || url.searchParams.has('bust') || url.searchParams.has('t')) return true;
  return false;
}

function isVersionedAsset(url) {
  return url.searchParams.has('v') && /\.(js|css)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await matchCached(request);
  if (cached) {
    refreshInBackground(request);
    return cached;
  }
  const response = await fetch(request);
  await putInCache(request, response);
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await putInCache(request, response);
    return response;
  } catch {
    const cached = await matchCached(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        if (mustNetworkFirst(request, url)) {
          return await networkFirst(request);
        }
        if (isVersionedAsset(url) || isAppShellRequest(request, url)) {
          return await cacheFirst(request);
        }
        return await networkFirst(request);
      } catch {
        if (request.mode === 'navigate') {
          const page = await caches.match('./index.html') || await caches.match('./');
          if (page) return page;
        }
        const path = url.pathname;
        if (/\.(js|css|json|png|webp|svg)$/i.test(path)) {
          const bare = await caches.match(`${url.origin}${path}`);
          if (bare) return bare;
        }
        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});
