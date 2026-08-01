// TickS Terrain — Service Worker v5
// logo.png retire du SHELL : le fichier du repo est un base64 tronque,
// le logo est desormais un SVG inline dans index.html.
const CACHE_APP   = 'ldm-app-v5';
const CACHE_TILES = 'ldm-tiles-v2';
const SHELL = ['./', './index.html', './manifest.json', './app.js', './sync.js'];

// Tuiles OSM pre-cachees : gares LDM Normandie z12
const PRECACHE_TILES = [
  // Rouen
  'https://tile.openstreetmap.org/12/2056/1394.png','https://tile.openstreetmap.org/12/2057/1394.png','https://tile.openstreetmap.org/12/2058/1394.png','https://tile.openstreetmap.org/12/2059/1394.png','https://tile.openstreetmap.org/12/2060/1394.png',
  'https://tile.openstreetmap.org/12/2056/1395.png','https://tile.openstreetmap.org/12/2057/1395.png','https://tile.openstreetmap.org/12/2058/1395.png','https://tile.openstreetmap.org/12/2059/1395.png','https://tile.openstreetmap.org/12/2060/1395.png',
  'https://tile.openstreetmap.org/12/2056/1396.png','https://tile.openstreetmap.org/12/2057/1396.png','https://tile.openstreetmap.org/12/2058/1396.png','https://tile.openstreetmap.org/12/2059/1396.png','https://tile.openstreetmap.org/12/2060/1396.png',
  'https://tile.openstreetmap.org/12/2056/1397.png','https://tile.openstreetmap.org/12/2057/1397.png','https://tile.openstreetmap.org/12/2058/1397.png','https://tile.openstreetmap.org/12/2059/1397.png','https://tile.openstreetmap.org/12/2060/1397.png',
  'https://tile.openstreetmap.org/12/2056/1398.png','https://tile.openstreetmap.org/12/2057/1398.png','https://tile.openstreetmap.org/12/2058/1398.png','https://tile.openstreetmap.org/12/2059/1398.png','https://tile.openstreetmap.org/12/2060/1398.png',
  // Caen
  'https://tile.openstreetmap.org/12/2022/1396.png','https://tile.openstreetmap.org/12/2023/1396.png','https://tile.openstreetmap.org/12/2024/1396.png','https://tile.openstreetmap.org/12/2025/1396.png','https://tile.openstreetmap.org/12/2026/1396.png',
  'https://tile.openstreetmap.org/12/2022/1397.png','https://tile.openstreetmap.org/12/2023/1397.png','https://tile.openstreetmap.org/12/2024/1397.png','https://tile.openstreetmap.org/12/2025/1397.png','https://tile.openstreetmap.org/12/2026/1397.png',
  'https://tile.openstreetmap.org/12/2022/1398.png','https://tile.openstreetmap.org/12/2023/1398.png','https://tile.openstreetmap.org/12/2024/1398.png','https://tile.openstreetmap.org/12/2025/1398.png','https://tile.openstreetmap.org/12/2026/1398.png',
  // Le Havre
  'https://tile.openstreetmap.org/12/2034/1393.png','https://tile.openstreetmap.org/12/2035/1393.png','https://tile.openstreetmap.org/12/2036/1393.png','https://tile.openstreetmap.org/12/2037/1393.png','https://tile.openstreetmap.org/12/2038/1393.png',
  'https://tile.openstreetmap.org/12/2034/1394.png','https://tile.openstreetmap.org/12/2035/1394.png','https://tile.openstreetmap.org/12/2036/1394.png','https://tile.openstreetmap.org/12/2037/1394.png','https://tile.openstreetmap.org/12/2038/1394.png',
  'https://tile.openstreetmap.org/12/2034/1395.png','https://tile.openstreetmap.org/12/2035/1395.png','https://tile.openstreetmap.org/12/2036/1395.png','https://tile.openstreetmap.org/12/2037/1395.png','https://tile.openstreetmap.org/12/2038/1395.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
  caches.open(CACHE_TILES).then(tc => {
    PRECACHE_TILES.forEach(url => {
      fetch(url, {mode:'no-cors'}).then(r => {
        if(r && (r.ok || r.type==='opaque')) tc.put(url, r);
      }).catch(()=>{});
    });
  });
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
  if(url.includes('tile.openstreetmap.org') ||
     url.includes('data.geopf.fr') ||
     url.includes('cdnjs.cloudflare.com/ajax/libs/leaflet')){
    e.respondWith(cacheTile(e.request));
    return;
  }
  // App shell : network-first pour recuperer les mises a jour rapidement
  if(e.request.mode === 'navigate' || SHELL.some(s => url.endsWith(s.replace('./','')))){
    e.respondWith(
      fetch(e.request).then(resp => {
        if(resp && resp.ok){
          const clone = resp.clone();
          caches.open(CACHE_APP).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  if(!url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

async function cacheTile(request){
  const cache  = await caches.open(CACHE_TILES);
  const cached = await cache.match(request);
  if(cached){
    fetch(request).then(r => { if(r && r.ok) cache.put(request, r); }).catch(()=>{});
    return cached;
  }
  try {
    const resp = await fetch(request);
    if(resp && resp.ok && resp.headers.get('content-type')?.includes('image')){
      cache.put(request, resp.clone());
      const keys = await cache.keys();
      if(keys.length > 3000)
        await Promise.all(keys.slice(0, keys.length-3000).map(k=>cache.delete(k)));
    }
    return resp;
  } catch(err) {
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c=>c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}