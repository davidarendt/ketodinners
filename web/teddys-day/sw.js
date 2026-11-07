const CACHE='teddys-day-v1';
const FILES=['./','index.html','manifest.json','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())) });
// Only prune our own caches — CacheStorage is shared across the origin with the
// other apps (ketodinners / weighttracker / housequest); never touch theirs.
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('teddys-day')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())) });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request).then(r=>{ if(r.ok||r.type==='opaque'){ const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)) } return r })
    .catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html')))
  );
});
