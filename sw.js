// CNIG Terrain — Service Worker
// Stratégie : Cache First + mise à jour en arrière-plan
const CACHE = 'cnig-terrain-v1';
const SHELL = ['./','./index.html','./manifest.json'];

// Installation : mise en cache de l'app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activation : purge des anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch : cache en priorité, réseau en fallback
self.addEventListener('fetch', e => {
  // Ne pas intercepter les requêtes externes (GPS API, etc.)
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Retourner le cache immédiatement
      if (cached) {
        // Mettre à jour en arrière-plan si réseau disponible
        fetch(e.request).then(fresh => {
          if (fresh && fresh.ok) {
            caches.open(CACHE).then(c => c.put(e.request, fresh));
          }
        }).catch(() => {});
        return cached;
      }
      // Pas en cache : réseau
      return fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        // Hors ligne et pas en cache : page offline minimale
        return new Response(
          '<html><body style="background:#0c1017;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:48px">📍</div><h2 style="margin:16px 0 8px">CNIG Terrain</h2><p style="color:#94a3b8">Hors ligne — données sauvegardées localement</p></div></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      });
    })
  );
});
