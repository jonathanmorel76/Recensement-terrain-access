// Recensement Terrain LDM — Service Worker v2
// Cache app shell + tuiles OSM pour utilisation hors ligne
const CACHE_APP   = 'ldm-app-v2';
const CACHE_TILES = 'ldm-tiles-v1';
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_APP && k !== CACHE_TILES)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Tuiles OSM + Leaflet JS/CSS → Cache First
  if(url.includes('tile.openstreetmap.org') ||
     url.includes('cdnjs.cloudflare.com/ajax/libs/leaflet')){
    e.respondWith(cacheTile(e.request));
    return;
  }

  // App shell → Cache First, réseau en fallback
  if(e.request.mode === 'navigate' || SHELL.some(s => url.endsWith(s))){
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(resp => {
          if(resp && resp.ok)
            caches.open(CACHE_APP).then(c => c.put(e.request, resp.clone()));
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Requêtes cross-origin (Overpass API) → réseau uniquement
  if(!url.startsWith(self.location.origin)) return;

  // Autres ressources locales → Network First
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

async function cacheTile(request){
  const cache  = await caches.open(CACHE_TILES);
  const cached = await cache.match(request);

  if(cached){
    // Retour immédiat + refresh silencieux en arrière-plan
    fetch(request).then(r => { if(r && r.ok) cache.put(request, r); }).catch(()=>{});
    return cached;
  }

  try {
    const resp = await fetch(request);
    if(resp && resp.ok && resp.headers.get('content-type')?.includes('image')){
      cache.put(request, resp.clone());
      // Limiter à ~2000 tuiles (~zone de travail typique)
      const keys = await cache.keys();
      if(keys.length > 2000)
        await Promise.all(keys.slice(0, keys.length-2000).map(k=>cache.delete(k)));
    }
    return resp;
  } catch(err) {
    // Hors ligne, tuile absente → pixel transparent
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c=>c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}
