// Weight tracker service worker — scoped to /weight/ only.
// Network-first for same-origin GETs (deploys show up), cache fallback offline.
// API + function calls are never cached. Cache name is namespaced so the
// keto app's SW cleanup won't touch it (and vice-versa).
const CACHE = 'weighttracker-v1';
const SHELL = [
  '/weight/',
  '/weight/static/app.js',
  '/weight/static/styles.css',
  '/weight/manifest.json',
  '/weight/icons/icon-192.png',
  '/weight/icons/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // Only clean up our OWN old caches.
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k.indexOf('weighttracker') === 0; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/.netlify/') === 0) return;
  // Only handle our own scope.
  if (url.pathname.indexOf('/weight/') !== 0) return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('/weight/'); });
    })
  );
});
