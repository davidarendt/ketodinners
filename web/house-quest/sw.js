// House Quest service worker — scoped to /house-quest/ only.
// Network-first for same-origin GETs (deploys show up), cache fallback offline.
// API + function calls are never cached. Cache name is namespaced so the keto
// and Almanac apps' SW cleanup won't touch it (and vice-versa).
const CACHE = 'housequest-v3';
const SHELL = [
  '/house-quest/',
  '/house-quest/static/app.js',
  '/house-quest/manifest.json',
  '/house-quest/icons/icon-192.png',
  '/house-quest/icons/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k.indexOf('housequest') === 0; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Push notifications from the hq-push-sender job.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'House Quest';
  var body = data.body || 'Something happened at the house.';
  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: '/house-quest/icons/icon-192.png',
    badge: '/house-quest/icons/icon-192.png',
    tag: 'house-quest',
    data: { url: data.url || '/house-quest/' },
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/house-quest/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf('/house-quest/') >= 0 && 'focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/.netlify/') === 0) return;
  if (url.pathname.indexOf('/house-quest/') !== 0) return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('/house-quest/'); });
    })
  );
});
