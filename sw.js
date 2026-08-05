// TickS Terrain — Service Worker v6
// logo.png retire du SHELL : le fichier du repo est un base64 tronque,
// le logo est desormais un SVG inline dans index.html.
const CACHE_APP   = 'ldm-app-v6';
const CACHE_TILES = 'ldm-tiles-v3';
const SHELL = ['./', './index.html', './manifest.json', './app.js', './sync.js'];

// Tuiles OSM pre-cachees.
// ATTENTION — les URL ci-dessous n'ont PAS de sous-domaine, et app.js doit
// demander ses tuiles a la MEME adresse. Jusqu'a la v5, TILE_OSM valait
// 'https://{s}.tile.openstreetmap.org/...' : Leaflet demandait donc
// a.|b.|c.tile.openstreetmap.org, les cles de cache ne correspondaient
// jamais, et ce pre-cache n'a JAMAIS servi hors ligne. Si un jour {s}
// revient dans app.js, il faut le remettre ici aussi.
// 306 tuiles, environ 7 Mo.
const PRECACHE_TILES = [
  // Normandie — fond regional z9-z10, pour se situer partout
  'https://tile.openstreetmap.org/10/506/347.png','https://tile.openstreetmap.org/10/506/348.png','https://tile.openstreetmap.org/10/506/349.png','https://tile.openstreetmap.org/10/506/350.png',
  'https://tile.openstreetmap.org/10/506/351.png','https://tile.openstreetmap.org/10/506/352.png','https://tile.openstreetmap.org/10/506/353.png','https://tile.openstreetmap.org/10/506/354.png',
  'https://tile.openstreetmap.org/10/507/347.png','https://tile.openstreetmap.org/10/507/348.png','https://tile.openstreetmap.org/10/507/349.png','https://tile.openstreetmap.org/10/507/350.png',
  'https://tile.openstreetmap.org/10/507/351.png','https://tile.openstreetmap.org/10/507/352.png','https://tile.openstreetmap.org/10/507/353.png','https://tile.openstreetmap.org/10/507/354.png',
  'https://tile.openstreetmap.org/10/508/347.png','https://tile.openstreetmap.org/10/508/348.png','https://tile.openstreetmap.org/10/508/349.png','https://tile.openstreetmap.org/10/508/350.png',
  'https://tile.openstreetmap.org/10/508/351.png','https://tile.openstreetmap.org/10/508/352.png','https://tile.openstreetmap.org/10/508/353.png','https://tile.openstreetmap.org/10/508/354.png',
  'https://tile.openstreetmap.org/10/509/347.png','https://tile.openstreetmap.org/10/509/348.png','https://tile.openstreetmap.org/10/509/349.png','https://tile.openstreetmap.org/10/509/350.png',
  'https://tile.openstreetmap.org/10/509/351.png','https://tile.openstreetmap.org/10/509/352.png','https://tile.openstreetmap.org/10/509/353.png','https://tile.openstreetmap.org/10/509/354.png',
  'https://tile.openstreetmap.org/10/510/347.png','https://tile.openstreetmap.org/10/510/348.png','https://tile.openstreetmap.org/10/510/349.png','https://tile.openstreetmap.org/10/510/350.png',
  'https://tile.openstreetmap.org/10/510/351.png','https://tile.openstreetmap.org/10/510/352.png','https://tile.openstreetmap.org/10/510/353.png','https://tile.openstreetmap.org/10/510/354.png',
  'https://tile.openstreetmap.org/10/511/347.png','https://tile.openstreetmap.org/10/511/348.png','https://tile.openstreetmap.org/10/511/349.png','https://tile.openstreetmap.org/10/511/350.png',
  'https://tile.openstreetmap.org/10/511/351.png','https://tile.openstreetmap.org/10/511/352.png','https://tile.openstreetmap.org/10/511/353.png','https://tile.openstreetmap.org/10/511/354.png',
  'https://tile.openstreetmap.org/10/512/347.png','https://tile.openstreetmap.org/10/512/348.png','https://tile.openstreetmap.org/10/512/349.png','https://tile.openstreetmap.org/10/512/350.png',
  'https://tile.openstreetmap.org/10/512/351.png','https://tile.openstreetmap.org/10/512/352.png','https://tile.openstreetmap.org/10/512/353.png','https://tile.openstreetmap.org/10/512/354.png',
  'https://tile.openstreetmap.org/10/513/347.png','https://tile.openstreetmap.org/10/513/348.png','https://tile.openstreetmap.org/10/513/349.png','https://tile.openstreetmap.org/10/513/350.png',
  'https://tile.openstreetmap.org/10/513/351.png','https://tile.openstreetmap.org/10/513/352.png','https://tile.openstreetmap.org/10/513/353.png','https://tile.openstreetmap.org/10/513/354.png',
  'https://tile.openstreetmap.org/10/514/347.png','https://tile.openstreetmap.org/10/514/348.png','https://tile.openstreetmap.org/10/514/349.png','https://tile.openstreetmap.org/10/514/350.png',
  'https://tile.openstreetmap.org/10/514/351.png','https://tile.openstreetmap.org/10/514/352.png','https://tile.openstreetmap.org/10/514/353.png','https://tile.openstreetmap.org/10/514/354.png',
  'https://tile.openstreetmap.org/10/515/347.png','https://tile.openstreetmap.org/10/515/348.png','https://tile.openstreetmap.org/10/515/349.png','https://tile.openstreetmap.org/10/515/350.png',
  'https://tile.openstreetmap.org/10/515/351.png','https://tile.openstreetmap.org/10/515/352.png','https://tile.openstreetmap.org/10/515/353.png','https://tile.openstreetmap.org/10/515/354.png',
  'https://tile.openstreetmap.org/10/516/347.png','https://tile.openstreetmap.org/10/516/348.png','https://tile.openstreetmap.org/10/516/349.png','https://tile.openstreetmap.org/10/516/350.png',
  'https://tile.openstreetmap.org/10/516/351.png','https://tile.openstreetmap.org/10/516/352.png','https://tile.openstreetmap.org/10/516/353.png','https://tile.openstreetmap.org/10/516/354.png',
  'https://tile.openstreetmap.org/10/517/347.png','https://tile.openstreetmap.org/10/517/348.png','https://tile.openstreetmap.org/10/517/349.png','https://tile.openstreetmap.org/10/517/350.png',
  'https://tile.openstreetmap.org/10/517/351.png','https://tile.openstreetmap.org/10/517/352.png','https://tile.openstreetmap.org/10/517/353.png','https://tile.openstreetmap.org/10/517/354.png',
  'https://tile.openstreetmap.org/9/253/173.png','https://tile.openstreetmap.org/9/253/174.png','https://tile.openstreetmap.org/9/253/175.png','https://tile.openstreetmap.org/9/253/176.png',
  'https://tile.openstreetmap.org/9/253/177.png','https://tile.openstreetmap.org/9/254/173.png','https://tile.openstreetmap.org/9/254/174.png','https://tile.openstreetmap.org/9/254/175.png',
  'https://tile.openstreetmap.org/9/254/176.png','https://tile.openstreetmap.org/9/254/177.png','https://tile.openstreetmap.org/9/255/173.png','https://tile.openstreetmap.org/9/255/174.png',
  'https://tile.openstreetmap.org/9/255/175.png','https://tile.openstreetmap.org/9/255/176.png','https://tile.openstreetmap.org/9/255/177.png','https://tile.openstreetmap.org/9/256/173.png',
  'https://tile.openstreetmap.org/9/256/174.png','https://tile.openstreetmap.org/9/256/175.png','https://tile.openstreetmap.org/9/256/176.png','https://tile.openstreetmap.org/9/256/177.png',
  'https://tile.openstreetmap.org/9/257/173.png','https://tile.openstreetmap.org/9/257/174.png','https://tile.openstreetmap.org/9/257/175.png','https://tile.openstreetmap.org/9/257/176.png',
  'https://tile.openstreetmap.org/9/257/177.png','https://tile.openstreetmap.org/9/258/173.png','https://tile.openstreetmap.org/9/258/174.png','https://tile.openstreetmap.org/9/258/175.png',
  'https://tile.openstreetmap.org/9/258/176.png','https://tile.openstreetmap.org/9/258/177.png',
  // Gares principales — z13 a z17, echelle utile pour un releve
  'https://tile.openstreetmap.org/13/4088/2807.png','https://tile.openstreetmap.org/13/4098/2796.png','https://tile.openstreetmap.org/13/4120/2781.png','https://tile.openstreetmap.org/13/4120/2797.png',
  'https://tile.openstreetmap.org/14/8176/5614.png','https://tile.openstreetmap.org/14/8197/5592.png','https://tile.openstreetmap.org/14/8241/5562.png','https://tile.openstreetmap.org/14/8241/5595.png',
  'https://tile.openstreetmap.org/15/16351/11227.png','https://tile.openstreetmap.org/15/16351/11228.png','https://tile.openstreetmap.org/15/16351/11229.png','https://tile.openstreetmap.org/15/16352/11227.png',
  'https://tile.openstreetmap.org/15/16352/11228.png','https://tile.openstreetmap.org/15/16352/11229.png','https://tile.openstreetmap.org/15/16353/11227.png','https://tile.openstreetmap.org/15/16353/11228.png',
  'https://tile.openstreetmap.org/15/16353/11229.png','https://tile.openstreetmap.org/15/16394/11183.png','https://tile.openstreetmap.org/15/16394/11184.png','https://tile.openstreetmap.org/15/16394/11185.png',
  'https://tile.openstreetmap.org/15/16395/11183.png','https://tile.openstreetmap.org/15/16395/11184.png','https://tile.openstreetmap.org/15/16395/11185.png','https://tile.openstreetmap.org/15/16396/11183.png',
  'https://tile.openstreetmap.org/15/16396/11184.png','https://tile.openstreetmap.org/15/16396/11185.png','https://tile.openstreetmap.org/15/16481/11123.png','https://tile.openstreetmap.org/15/16481/11124.png',
  'https://tile.openstreetmap.org/15/16481/11125.png','https://tile.openstreetmap.org/15/16482/11123.png','https://tile.openstreetmap.org/15/16482/11124.png','https://tile.openstreetmap.org/15/16482/11125.png',
  'https://tile.openstreetmap.org/15/16482/11189.png','https://tile.openstreetmap.org/15/16482/11190.png','https://tile.openstreetmap.org/15/16482/11191.png','https://tile.openstreetmap.org/15/16483/11123.png',
  'https://tile.openstreetmap.org/15/16483/11124.png','https://tile.openstreetmap.org/15/16483/11125.png','https://tile.openstreetmap.org/15/16483/11189.png','https://tile.openstreetmap.org/15/16483/11190.png',
  'https://tile.openstreetmap.org/15/16483/11191.png','https://tile.openstreetmap.org/15/16484/11189.png','https://tile.openstreetmap.org/15/16484/11190.png','https://tile.openstreetmap.org/15/16484/11191.png',
  'https://tile.openstreetmap.org/16/32703/22456.png','https://tile.openstreetmap.org/16/32703/22457.png','https://tile.openstreetmap.org/16/32703/22458.png','https://tile.openstreetmap.org/16/32704/22456.png',
  'https://tile.openstreetmap.org/16/32704/22457.png','https://tile.openstreetmap.org/16/32704/22458.png','https://tile.openstreetmap.org/16/32705/22456.png','https://tile.openstreetmap.org/16/32705/22457.png',
  'https://tile.openstreetmap.org/16/32705/22458.png','https://tile.openstreetmap.org/16/32789/22368.png','https://tile.openstreetmap.org/16/32789/22369.png','https://tile.openstreetmap.org/16/32789/22370.png',
  'https://tile.openstreetmap.org/16/32790/22368.png','https://tile.openstreetmap.org/16/32790/22369.png','https://tile.openstreetmap.org/16/32790/22370.png','https://tile.openstreetmap.org/16/32791/22368.png',
  'https://tile.openstreetmap.org/16/32791/22369.png','https://tile.openstreetmap.org/16/32791/22370.png','https://tile.openstreetmap.org/16/32963/22247.png','https://tile.openstreetmap.org/16/32963/22248.png',
  'https://tile.openstreetmap.org/16/32963/22249.png','https://tile.openstreetmap.org/16/32964/22247.png','https://tile.openstreetmap.org/16/32964/22248.png','https://tile.openstreetmap.org/16/32964/22249.png',
  'https://tile.openstreetmap.org/16/32965/22247.png','https://tile.openstreetmap.org/16/32965/22248.png','https://tile.openstreetmap.org/16/32965/22249.png','https://tile.openstreetmap.org/16/32966/22380.png',
  'https://tile.openstreetmap.org/16/32966/22381.png','https://tile.openstreetmap.org/16/32966/22382.png','https://tile.openstreetmap.org/16/32967/22380.png','https://tile.openstreetmap.org/16/32967/22381.png',
  'https://tile.openstreetmap.org/16/32967/22382.png','https://tile.openstreetmap.org/16/32968/22380.png','https://tile.openstreetmap.org/16/32968/22381.png','https://tile.openstreetmap.org/16/32968/22382.png',
  'https://tile.openstreetmap.org/17/65407/44913.png','https://tile.openstreetmap.org/17/65407/44914.png','https://tile.openstreetmap.org/17/65407/44915.png','https://tile.openstreetmap.org/17/65407/44916.png',
  'https://tile.openstreetmap.org/17/65407/44917.png','https://tile.openstreetmap.org/17/65408/44913.png','https://tile.openstreetmap.org/17/65408/44914.png','https://tile.openstreetmap.org/17/65408/44915.png',
  'https://tile.openstreetmap.org/17/65408/44916.png','https://tile.openstreetmap.org/17/65408/44917.png','https://tile.openstreetmap.org/17/65409/44913.png','https://tile.openstreetmap.org/17/65409/44914.png',
  'https://tile.openstreetmap.org/17/65409/44915.png','https://tile.openstreetmap.org/17/65409/44916.png','https://tile.openstreetmap.org/17/65409/44917.png','https://tile.openstreetmap.org/17/65410/44913.png',
  'https://tile.openstreetmap.org/17/65410/44914.png','https://tile.openstreetmap.org/17/65410/44915.png','https://tile.openstreetmap.org/17/65410/44916.png','https://tile.openstreetmap.org/17/65410/44917.png',
  'https://tile.openstreetmap.org/17/65411/44913.png','https://tile.openstreetmap.org/17/65411/44914.png','https://tile.openstreetmap.org/17/65411/44915.png','https://tile.openstreetmap.org/17/65411/44916.png',
  'https://tile.openstreetmap.org/17/65411/44917.png','https://tile.openstreetmap.org/17/65578/44736.png','https://tile.openstreetmap.org/17/65578/44737.png','https://tile.openstreetmap.org/17/65578/44738.png',
  'https://tile.openstreetmap.org/17/65578/44739.png','https://tile.openstreetmap.org/17/65578/44740.png','https://tile.openstreetmap.org/17/65579/44736.png','https://tile.openstreetmap.org/17/65579/44737.png',
  'https://tile.openstreetmap.org/17/65579/44738.png','https://tile.openstreetmap.org/17/65579/44739.png','https://tile.openstreetmap.org/17/65579/44740.png','https://tile.openstreetmap.org/17/65580/44736.png',
  'https://tile.openstreetmap.org/17/65580/44737.png','https://tile.openstreetmap.org/17/65580/44738.png','https://tile.openstreetmap.org/17/65580/44739.png','https://tile.openstreetmap.org/17/65580/44740.png',
  'https://tile.openstreetmap.org/17/65581/44736.png','https://tile.openstreetmap.org/17/65581/44737.png','https://tile.openstreetmap.org/17/65581/44738.png','https://tile.openstreetmap.org/17/65581/44739.png',
  'https://tile.openstreetmap.org/17/65581/44740.png','https://tile.openstreetmap.org/17/65582/44736.png','https://tile.openstreetmap.org/17/65582/44737.png','https://tile.openstreetmap.org/17/65582/44738.png',
  'https://tile.openstreetmap.org/17/65582/44739.png','https://tile.openstreetmap.org/17/65582/44740.png','https://tile.openstreetmap.org/17/65926/44494.png','https://tile.openstreetmap.org/17/65926/44495.png',
  'https://tile.openstreetmap.org/17/65926/44496.png','https://tile.openstreetmap.org/17/65926/44497.png','https://tile.openstreetmap.org/17/65926/44498.png','https://tile.openstreetmap.org/17/65927/44494.png',
  'https://tile.openstreetmap.org/17/65927/44495.png','https://tile.openstreetmap.org/17/65927/44496.png','https://tile.openstreetmap.org/17/65927/44497.png','https://tile.openstreetmap.org/17/65927/44498.png',
  'https://tile.openstreetmap.org/17/65928/44494.png','https://tile.openstreetmap.org/17/65928/44495.png','https://tile.openstreetmap.org/17/65928/44496.png','https://tile.openstreetmap.org/17/65928/44497.png',
  'https://tile.openstreetmap.org/17/65928/44498.png','https://tile.openstreetmap.org/17/65929/44494.png','https://tile.openstreetmap.org/17/65929/44495.png','https://tile.openstreetmap.org/17/65929/44496.png',
  'https://tile.openstreetmap.org/17/65929/44497.png','https://tile.openstreetmap.org/17/65929/44498.png','https://tile.openstreetmap.org/17/65930/44494.png','https://tile.openstreetmap.org/17/65930/44495.png',
  'https://tile.openstreetmap.org/17/65930/44496.png','https://tile.openstreetmap.org/17/65930/44497.png','https://tile.openstreetmap.org/17/65930/44498.png','https://tile.openstreetmap.org/17/65932/44760.png',
  'https://tile.openstreetmap.org/17/65932/44761.png','https://tile.openstreetmap.org/17/65932/44762.png','https://tile.openstreetmap.org/17/65932/44763.png','https://tile.openstreetmap.org/17/65932/44764.png',
  'https://tile.openstreetmap.org/17/65933/44760.png','https://tile.openstreetmap.org/17/65933/44761.png','https://tile.openstreetmap.org/17/65933/44762.png','https://tile.openstreetmap.org/17/65933/44763.png',
  'https://tile.openstreetmap.org/17/65933/44764.png','https://tile.openstreetmap.org/17/65934/44760.png','https://tile.openstreetmap.org/17/65934/44761.png','https://tile.openstreetmap.org/17/65934/44762.png',
  'https://tile.openstreetmap.org/17/65934/44763.png','https://tile.openstreetmap.org/17/65934/44764.png','https://tile.openstreetmap.org/17/65935/44760.png','https://tile.openstreetmap.org/17/65935/44761.png',
  'https://tile.openstreetmap.org/17/65935/44762.png','https://tile.openstreetmap.org/17/65935/44763.png','https://tile.openstreetmap.org/17/65935/44764.png','https://tile.openstreetmap.org/17/65936/44760.png',
  'https://tile.openstreetmap.org/17/65936/44761.png','https://tile.openstreetmap.org/17/65936/44762.png','https://tile.openstreetmap.org/17/65936/44763.png','https://tile.openstreetmap.org/17/65936/44764.png'
];


self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
  // Pre-cache par lots de 8 : 306 requetes simultanees font tomber le
  // debit a plat sur un partage de connexion, et OSM etrangle les rafales.
  caches.open(CACHE_TILES).then(async tc => {
    for(let i=0;i<PRECACHE_TILES.length;i+=8){
      await Promise.all(PRECACHE_TILES.slice(i,i+8).map(url =>
        fetch(url, {mode:'no-cors'})
          .then(r => { if(r && (r.ok || r.type==='opaque')) return tc.put(url, r); })
          .catch(()=>{})
      ));
    }
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