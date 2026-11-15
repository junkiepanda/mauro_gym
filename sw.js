// Offline cache for Mauro_gym. Bump VERSION whenever any app file changes.
const VERSION = 'mg-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'program.js', 'xlsx.js', 'manifest.webmanifest',
  'fonts/oswald.woff2', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
      fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
