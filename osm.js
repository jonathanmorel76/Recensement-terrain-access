// ══════════════════════════════════════════════════════════════
// osm.js — TickS Terrain
// Reference OSM telechargee PAR GARE, a l'avance, pour disposer sur place
// des cheminements et equipements deja cartographies.
//
// Meme principe que le pre-cache des tuiles : on prepare au bureau, on
// consomme sur le terrain sans reseau. Mais contrairement aux tuiles, le
// telechargement est ici a la demande, gare par gare : charger les 33 sites
// d'un coup representerait plusieurs megaoctets pour un usage ou l'on ne
// visite qu'un site a la fois.
//
// SEPARATION STRICTE AVEC LES RELEVES
// -----------------------------------
// Ces donnees ne sont JAMAIS synchronisees vers Supabase et ne rejoignent
// jamais S.waypoints ni S.tracks. Elles vivent dans leur propre base
// IndexedDB et leur propre couche Leaflet. La raison est simple : le schema
// n'accepte que 'gps' et 'manuel' comme mode de saisie, et surtout un objet
// vu dans OSM n'est pas un objet constate sur le terrain. Melanger les deux
// reviendrait a livrer de la donnee tierce comme si elle avait ete relevee.
//
// Le seul pont entre les deux mondes est l'ADOPTION : reprendre la geometrie
// d'un cheminement OSM comme point de depart d'un trace, que l'operateur
// valide ensuite sommet par sommet sur l'orthophoto. Le resultat est alors
// bien une saisie manuelle, puisqu'il l'a effectivement validee.
// ══════════════════════════════════════════════════════════════

const OSM_DB = 'ticks-osm-ref', OSM_VER = 1;
// Relais configurable. Par defaut la fonction Vercel, mais Overpass BLOQUE
// les plages AWS et Azure depuis octobre 2025 pour se proteger d'un usage
// abusif depuis le cloud : Vercel s'executant sur AWS, ses requetes sont
// rejetees sans code d'erreur, ce qui se lit comme un depassement de delai
// sur tous les miroirs a la fois. Un relais Cloudflare (worker.mjs) contourne
// le probleme ; son URL se colle dans l'ecran Reference OSM.
const RELAIS_DEFAUT = '/api/overpass';
function relaisURL(){
  try{ return localStorage.getItem('ticks_relais_osm') || RELAIS_DEFAUT; }
  catch(e){ return RELAIS_DEFAUT; }
}
// Instance francaise en tete : la plus proche pour des donnees normandes, et
// moins sollicitee que l'instance principale allemande.
const MIROIRS_OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const RAYON_DEFAUT = 500;

// Emprise Normandie, pour borner la recherche de gare. Sans borne, une
// recherche « Saint-Pierre » renverrait des gares de toute la France.
const BBOX_NORMANDIE = [48.15, -2.05, 50.15, 1.95];

let OSM_LAYER = null;          // couche Leaflet de la reference affichee
let OSM_ACTIVE = null;         // gare actuellement chargee
let OSM_VISIBLE = false;

// ── Stockage ──────────────────────────────────────────────────
function osmDB(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(OSM_DB, OSM_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('gares')) db.createObjectStore('gares', {keyPath:'slug'});
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function osmPut(rec){
  const db = await osmDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('gares','readwrite');
    tx.objectStore('gares').put(rec);
    tx.oncomplete = () => res(); tx.onerror = e => rej(e.target.error);
  });
}
async function osmGet(slug){
  const db = await osmDB();
  return new Promise((res, rej) => {
    const r = db.transaction('gares','readonly').objectStore('gares').get(slug);
    r.onsuccess = () => res(r.result || null); r.onerror = e => rej(e.target.error);
  });
}
async function osmList(){
  const db = await osmDB();
  return new Promise((res) => {
    const r = db.transaction('gares','readonly').objectStore('gares').getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => res([]);
  });
}
async function osmDel(slug){
  const db = await osmDB();
  return new Promise((res) => {
    const tx = db.transaction('gares','readwrite');
    tx.objectStore('gares').delete(slug);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}

function slugify(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// ── Correspondance OSM -> taxonomie CNIG du projet ────────────
// Le but n'est pas de classer a la place de l'operateur mais de lui montrer
// ce qu'OSM pretend savoir, dans SON vocabulaire a lui. Un ascenseur OSM
// s'affiche donc « ASCENSEUR » et non « highway=elevator ».
function mapperOSM(tags){
  const t = tags || {};
  if(t.highway === 'elevator')                 return ['equip_acces','ASCENSEUR'];
  if(t.highway === 'steps')                    return ['equip_acces', t.conveying && t.conveying!=='no' ? 'ESCALATOR' : 'ESCALIER'];
  if(t.conveying === 'yes' && t.highway)       return ['equip_acces','TAPIS_ROULANT'];
  if(t.highway === 'crossing')                 return ['equip_acces','TRAVERSEE_PIETONS'];
  if(t.kerb === 'lowered' || t.barrier === 'kerb') return ['equip_acces','ABAISSEMENT_TROTTOIR'];
  if(t.barrier === 'turnstile')                return ['equip_acces','PASSAGE_SELECTIF'];
  if(t.amenity === 'ticket_validator')         return ['equip_comp','VALIDATEUR'];
  if(t.amenity === 'vending_machine' && /ticket/.test(t.vending||'')) return ['equip_comp','DISTRIBUTEUR_TITRES'];
  if(t.tourism === 'information')              return ['equip_comp','BORNE_INFO'];
  if(t.amenity === 'bench')                    return ['autre','BANC'];
  if(t.amenity === 'shelter')                  return ['autre','ABRI'];
  if(t.amenity === 'toilets')                  return ['autre','TOILETTES'];
  if(t.amenity === 'waiting_room' || t.public_transport === 'waiting_room') return ['autre','SALLE_ATTENTE'];
  if(t.amenity === 'bicycle_parking')          return ['autre','STATIONNEMENT_VELO'];
  if(t.emergency === 'phone' || t.amenity === 'help_point') return ['autre','ASSISTANCE'];
  if(t.railway === 'subway_entrance' || t.railway === 'train_station_entrance') return ['entree','PRINCIPALE'];
  if(t.entrance){
    const m = {main:'PRINCIPALE', yes:'SECONDAIRE', service:'SERVICE', emergency:'URGENCE'};
    return ['entree', m[t.entrance] || 'SECONDAIRE'];
  }
  if(t.railway === 'platform' || t.public_transport === 'platform') return ['noeud','ARRET_TC'];
  return ['autre','A_CLASSIFIER'];
}

// ── Requetes Overpass ─────────────────────────────────────────
async function overpass(ql){
  const echecs = [];

  // 1) Relais serveur. Il renvoie toujours du JSON, y compris en erreur, donc
  //    son diagnostic est exploitable tel quel.
  try{
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 70000);
    const r = await fetch(relaisURL() + '?data=' + encodeURIComponent(ql), {signal:ctrl.signal});
    clearTimeout(t);
    const d = await r.json().catch(() => null);
    if(r.ok && d && !d.erreur) return d;
    if(d && Array.isArray(d.echecs)){
      d.echecs.forEach(e => echecs.push(`${e.hote} : ${e.message}`));
    }else{
      echecs.push('relais : HTTP ' + r.status);
    }
  }catch(err){
    // Un relais absent (app servie hors Vercel) ou une coupure reseau.
    echecs.push('relais : ' + (err.name==='AbortError' ? 'delai de 70 s depasse' : err.message));
  }

  // 2) Repli direct. Sur navigateur les erreurs amont perdent leurs en-tetes
  //    CORS et remontent en « Load failed » sans detail : c'est precisement
  //    ce que le relais evite, d'ou son passage en premier.
  for(const url of MIROIRS_OVERPASS){
    try{
      const ctrl = new AbortController();
      const minuteur = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url + '?data=' + encodeURIComponent(ql), {method:'GET', signal:ctrl.signal});
      clearTimeout(minuteur);
      if(!r.ok){ echecs.push(`${hote(url)} : HTTP ${r.status}`); continue; }
      const ct = r.headers.get('content-type') || '';
      if(!/json/i.test(ct)){ echecs.push(`${hote(url)} : r\u00e9ponse non-JSON`); continue; }
      const d = await r.json();
      if(d.remark){ echecs.push(`${hote(url)} : ${String(d.remark).slice(0,160)}`); continue; }
      return d;
    }catch(err){
      echecs.push(`${hote(url)} : ${err.name==='AbortError'?'delai depasse':err.message}`);
    }
  }

  const e = new Error(echecs.join(' | '));
  e.detail = echecs;
  throw e;
}

function hote(u){ try{ return new URL(u).hostname.split('.')[0]; }catch(e){ return u; } }

async function chercherGare(nom){
  const [s,w,n,e] = BBOX_NORMANDIE;
  const q = nom.replace(/["\\]/g,'');
  // Le filtre de TETE doit etre une egalite exacte, jamais une expression
  // reguliere : Overpass sait resoudre ["railway"="station"] par son index,
  // alors qu'une regex l'oblige a balayer toute l'emprise. La version
  // precedente combinait DEUX regex (railway et name) sur la Normandie
  // entiere, ce qui depassait le delai serveur et renvoyait 504.
  // On enumere donc les combinaisons plutot que de les factoriser : plus
  // verbeux, mais indexe.
  const lignes = [];
  for(const type of ['node','way','relation'])
    for(const val of ['station','halt'])
      lignes.push(`  ${type}["railway"="${val}"]["name"~"${q}",i](${s},${w},${n},${e});`);
  const ql = `[out:json][timeout:18];\n(\n${lignes.join('\n')}\n);\nout center 20;`;
  const d = await overpass(ql);
  return (d.elements||[]).map(el => ({
    nom: el.tags?.name || 'Sans nom',
    uic: el.tags?.['ref:SNCF'] || el.tags?.uic_ref || null,
    lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon
  })).filter(g => g.lat != null);
}

// Repli sans recherche : telecharger la zone actuellement affichee sur la
// carte. Ne depend d'aucune requete de recherche, donc reste disponible quand
// le nom ne donne rien ou que le service peine. C'est souvent le plus direct :
// l'operateur sait ou est la gare, il la cadre a l'ecran.
async function telechargerVue(){
  if(!MAP_OK){ toast('Carte non pr\u00eate','a'); return; }
  const nom = (document.getElementById('osm-q').value || '').trim();
  if(nom.length < 3){ toast('Indiquez d\'abord un nom pour cette zone','a'); return; }
  const c = MAP.getCenter();
  const rayon = parseInt(document.getElementById('osm-rayon').value,10) || RAYON_DEFAUT;
  try{
    const rec = await telechargerGare({nom, lat:c.lat, lon:c.lng, uic:null}, rayon);
    document.getElementById('osm-res').innerHTML = '';
    document.getElementById('osm-q').value = '';
    await renderOSM();
    toast(rec.nom + ' \u2014 ' + Math.round(rec.taille/1024) + ' Ko enregistr\u00e9s','g');
  }catch(err){
    console.error('[OSM] vue', err.detail || err);
    document.getElementById('osm-res').innerHTML =
      '<div class="empty" style="text-align:left">' + (err.detail||[err.message]).map(x=>'&bull; '+esc(x)).join('<br>') + '</div>';
    toast('\u00c9chec du t\u00e9l\u00e9chargement','r');
  }
}

// Le reseau pietonnier ET les equipements en UNE requete : deux appels
// separes doubleraient l'attente sur un service souvent charge.
function qlGare(lat, lon, rayon){
  // Le timeout annonce doit rester SOUS le budget du relais (20 s par miroir).
  // A 90 s, Overpass acceptait de travailler bien au-dela du temps disponible :
  // la fonction etait tuee avant qu'il ne reponde, et aucun miroir n'etait
  // jamais essaye. Mieux vaut qu'Overpass renonce vite et renvoie un « remark »
  // exploitable.
  //
  // Les clauses sont regroupees par type d'objet plutot qu'une par tag : le
  // filtre « around » est evalue en premier et ramene un ensemble reduit, sur
  // lequel une expression reguliere ne coute plus rien. Onze clauses separees
  // recalculaient onze fois le meme voisinage.
  const a = `around:${rayon},${lat},${lon}`;
  return `[out:json][timeout:18];
(
  way(${a})["highway"~"^(footway|path|pedestrian|steps|corridor|living_street)$"];
  way(${a})["highway"]["foot"~"^(yes|designated)$"];
  way(${a})["railway"="platform"];
  way(${a})["public_transport"="platform"];
  node(${a})["highway"~"^(elevator|crossing)$"];
  node(${a})["amenity"~"^(bench|shelter|toilets|ticket_validator|bicycle_parking|waiting_room|vending_machine|help_point)$"];
  node(${a})["railway"~"^(subway_entrance|train_station_entrance)$"];
  node(${a})["barrier"~"^(turnstile|kerb|gate)$"];
  node(${a})["entrance"];
  node(${a})["emergency"="phone"];
  node(${a})["tourism"="information"];
);
out geom;`;
}

// Les attributs d'accessibilite qu'OSM porte reellement et qui interessent le
// recensement. Tout le reste des tags est ecarte : c'est ce qui fait la
// difference entre 80 Ko et 900 Ko par gare.
const TAGS_UTILES = ['wheelchair','tactile_paving','ramp','handrail','step_count',
  'incline','width','surface','smoothness','kerb','conveying','automatic_door',
  'door','name','ref','level','indoor','covered','capacity','capacity:disabled',
  'highway','railway','amenity','entrance','barrier','public_transport','emergency',
  'tourism','vending','information','access','foot'];

function compacter(elements){
  const lignes = [], points = [];
  for(const el of elements){
    const tags = {};
    for(const k of TAGS_UTILES) if(el.tags && el.tags[k] != null) tags[k] = el.tags[k];
    if(el.type === 'way' && el.geometry){
      // Coordonnees en tableaux plats et arrondies a 6 decimales (~11 cm) :
      // la precision au-dela n'a aucun sens ici et double le volume.
      lignes.push({i:el.id, t:tags,
        g:el.geometry.map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6)])});
    }else if(el.type === 'node' && el.lat != null){
      points.push({i:el.id, t:tags, g:[+el.lat.toFixed(6), +el.lon.toFixed(6)]});
    }
  }
  return {lignes, points};
}

async function telechargerGare(gare, rayon){
  toast('T\u00e9l\u00e9chargement OSM\u2026');
  const d = await overpass(qlGare(gare.lat, gare.lon, rayon));
  const {lignes, points} = compacter(d.elements || []);
  const rec = {
    slug: slugify(gare.nom), nom: gare.nom, uic: gare.uic || null,
    lat: gare.lat, lon: gare.lon, rayon,
    lignes, points, maj: Date.now()
  };
  rec.taille = new Blob([JSON.stringify(rec)]).size;
  await osmPut(rec);
  return rec;
}

// ── Affichage ─────────────────────────────────────────────────
function afficherGare(rec){
  if(!MAP_OK) return;
  masquerOSM();
  OSM_LAYER = L.layerGroup().addTo(MAP);
  OSM_ACTIVE = rec; OSM_VISIBLE = true;

  // Cheminements en tirete gris-bleu : volontairement DIFFERENT des traces de
  // l'operateur, qui sont en violet plein. A aucun moment on ne doit pouvoir
  // confondre une donnee tierce avec un releve.
  rec.lignes.forEach(l => {
    const quai = l.t.railway === 'platform' || l.t.public_transport === 'platform';
    L.polyline(l.g, {color: quai ? '#0891B2' : '#64748B', weight: quai ? 3 : 2,
      opacity:.75, dashArray: quai ? null : '5,4'})
      .bindPopup(popupOSM(l, true))
      .addTo(OSM_LAYER);
  });
  rec.points.forEach(p => {
    const [type, sub] = mapperOSM(p.t);
    const col = (typeof COLORS !== 'undefined' && COLORS[type]) || '#64748B';
    L.circleMarker(p.g, {radius:6, color:col, weight:2, fillColor:'#fff', fillOpacity:.85, dashArray:'2,2'})
      .bindPopup(popupOSM(p, false))
      .addTo(OSM_LAYER);
  });
  const btn = document.getElementById('btn-osm');
  if(btn) btn.classList.add('on');
  toast(rec.nom + ' \u2014 ' + rec.lignes.length + ' cheminements, ' + rec.points.length + ' objets');
}

function popupOSM(el, estLigne){
  const [type, sub] = mapperOSM(el.t);
  const nom = el.t.name || el.t.ref || (estLigne ? 'Cheminement' : 'Objet');
  const acc = [];
  if(el.t.wheelchair) acc.push('fauteuil : ' + el.t.wheelchair);
  if(el.t.tactile_paving) acc.push('bande podotactile : ' + el.t.tactile_paving);
  if(el.t.step_count) acc.push(el.t.step_count + ' marches');
  if(el.t.incline) acc.push('pente : ' + el.t.incline);
  if(el.t.width) acc.push('largeur : ' + el.t.width + ' m');
  if(el.t.handrail) acc.push('main courante : ' + el.t.handrail);
  let h = '<div style="font:600 13px -apple-system,sans-serif">' + esc(nom) + '</div>'
    + '<div style="font-size:11px;color:#666;margin:3px 0">' + sub.replace(/_/g,' ').toLowerCase()
    + ' &middot; OSM ' + (estLigne ? 'way' : 'node') + '/' + el.i + '</div>';
  if(acc.length) h += '<div style="font-size:11px;line-height:1.5">' + acc.map(esc).join('<br>') + '</div>';
  h += '<div style="font-size:10px;color:#999;margin-top:6px;font-style:italic">'
     + 'Donn\u00e9e OSM &mdash; \u00e0 v\u00e9rifier sur place</div>';
  if(estLigne && el.g.length >= 2){
    h += '<button onclick="adopterCheminement(' + el.i + ')" style="margin-top:8px;width:100%;'
      + 'padding:8px;border:none;border-radius:9px;background:#8A3090;color:#fff;'
      + 'font:600 12px -apple-system,sans-serif">Reprendre comme trac\u00e9</button>';
  }
  return h;
}

function masquerOSM(){
  if(OSM_LAYER){ try{ MAP.removeLayer(OSM_LAYER); }catch(e){} OSM_LAYER = null; }
  OSM_VISIBLE = false;
  const btn = document.getElementById('btn-osm');
  if(btn) btn.classList.remove('on');
}

function toggleOSM(){
  if(OSM_VISIBLE){ masquerOSM(); return; }
  if(OSM_ACTIVE){ afficherGare(OSM_ACTIVE); return; }
  goTab('osm');
}

// ── Adoption d'un cheminement ─────────────────────────────────
// Reprend la geometrie OSM comme point de depart d'un trace. L'operateur
// valide ou corrige chaque sommet sur l'orthophoto avant d'enregistrer : le
// troncon produit est donc bien une saisie manuelle, et non une copie de
// donnee tierce presentee comme un releve.
function adopterCheminement(idWay){
  if(!OSM_ACTIVE) return;
  const l = OSM_ACTIVE.lignes.find(x => x.i === idWay);
  if(!l) return;
  if(S.recording){ toast('Terminez le tron\u00e7on en cours','a'); return; }
  MAP.closePopup();
  startTrace();
  const t = S.tracks[S.curTrack];
  // Un cheminement OSM peut compter des centaines de sommets ; au-dela d'une
  // trentaine le trace devient impossible a corriger au doigt. On echantillonne
  // en conservant toujours les deux extremites.
  const pas = Math.max(1, Math.ceil(l.g.length / 30));
  l.g.forEach((c, i) => {
    if(i % pas === 0 || i === l.g.length - 1)
      t.pts.push({lat:c[0], lon:c[1], ts:Date.now(), acc:null, source:'manuel'});
  });
  t.name = (l.t.name || 'Cheminement') + ' (OSM \u00e0 v\u00e9rifier)';
  const nm = document.getElementById('trk-name'); if(nm) nm.value = t.name;
  redrawTrace(); updateTrkStats(); updateTraceUI();
  MAP.fitBounds(L.polyline(l.g).getBounds(), {padding:[40,40]});
  toast(t.pts.length + ' sommets repris \u2014 corrigez puis validez','a');
}

// ── Interface de gestion ──────────────────────────────────────
function enregistrerRelais(){
  const v = document.getElementById('osm-relais').value.trim();
  try{
    if(v) localStorage.setItem('ticks_relais_osm', v.replace(/\/$/,''));
    else localStorage.removeItem('ticks_relais_osm');
  }catch(e){}
  toast(v ? 'Relais enregistr\u00e9' : 'Relais par d\u00e9faut r\u00e9tabli','g');
}

async function testerRelais(){
  const res = document.getElementById('osm-res');
  res.innerHTML = '<div class="empty">Test en cours\u2026</div>';
  const t0 = Date.now();
  try{
    // Requete deliberement minuscule : elle mesure la joignabilite du relais,
    // pas la capacite d'Overpass a traiter une vraie demande.
    const d = await overpass('[out:json][timeout:10];node(1);out;');
    res.innerHTML = '<div class="empty" style="color:var(--green)"><b>Relais op\u00e9rationnel</b><br>'
      + 'r\u00e9ponse en ' + ((Date.now()-t0)/1000).toFixed(1) + ' s</div>';
  }catch(e){
    res.innerHTML = '<div class="empty" style="text-align:left"><b>\u00c9chec du test</b><br><br>'
      + (e.detail||[e.message]).map(x=>'&bull; '+esc(x)).join('<br>') + '</div>';
  }
}

async function renderOSM(){
  const champ = document.getElementById('osm-relais');
  if(champ && !champ.value){
    try{ champ.value = localStorage.getItem('ticks_relais_osm') || ''; }catch(e){}
  }
  const el = document.getElementById('osm-list'); if(!el) return;
  const gares = await osmList();
  if(!gares.length){
    el.innerHTML = '<div class="empty">Aucune gare t\u00e9l\u00e9charg\u00e9e.<br>'
      + 'Recherchez-en une ci-dessus, avec du r\u00e9seau,<br>pour la consulter ensuite hors ligne.</div>';
    return;
  }
  const total = gares.reduce((s,g) => s + (g.taille||0), 0);
  el.innerHTML = gares.sort((a,b) => a.nom.localeCompare(b.nom)).map(g => {
    const ko = Math.round((g.taille||0)/1024);
    const j = Math.floor((Date.now() - g.maj)/86400000);
    return '<div class="wpt-item">'
      + '<div class="wdot" style="background:rgba(138,48,144,.12);color:var(--ticks)">'
      + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 6"/></svg></div>'
      + '<div class="winfo" onclick="chargerGare(\'' + g.slug + '\')" style="cursor:pointer">'
      + '<div class="wname">' + esc(g.nom) + '</div>'
      + '<div class="wmeta">' + g.lignes.length + ' cheminements &middot; ' + g.points.length
      + ' objets &middot; ' + ko + ' Ko &middot; ' + (j ? 'il y a ' + j + ' j' : "aujourd'hui") + '</div></div>'
      + '<button class="wbtn" onclick="supprimerGare(\'' + g.slug + '\')" aria-label="Supprimer">&times;</button></div>';
  }).join('')
  + '<div style="text-align:center;font-size:11.5px;color:var(--txt3);margin-top:10px">'
  + gares.length + ' gare(s) &middot; ' + Math.round(total/1024) + ' Ko au total</div>';
}

async function chercherGareUI(){
  const q = document.getElementById('osm-q').value.trim();
  if(q.length < 3){ toast('Au moins 3 caract\u00e8res','a'); return; }
  const res = document.getElementById('osm-res');
  res.innerHTML = '<div class="empty">Recherche\u2026</div>';
  try{
    const gares = await chercherGare(q);
    if(!gares.length){ res.innerHTML = '<div class="empty">Aucune gare trouv\u00e9e en Normandie.</div>'; return; }
    res.innerHTML = gares.map((g,i) =>
      '<div class="wpt-item" onclick="telechargerIdx(' + i + ')" style="cursor:pointer">'
      + '<div class="winfo"><div class="wname">' + esc(g.nom) + '</div>'
      + '<div class="wmeta">' + (g.uic ? 'UIC ' + g.uic + ' &middot; ' : '')
      + g.lat.toFixed(4) + ', ' + g.lon.toFixed(4) + '</div></div>'
      + '<span class="wbtn">&darr;</span></div>').join('');
    window.__osmRes = gares;
  }catch(e){
    // Le detail des echecs par miroir est affiche : « quota atteint » et
    // « pas de reseau » appellent des reactions differentes, et l'ancien
    // message unique ne permettait pas de les distinguer.
    console.error('[OSM] Overpass', e.detail || e);
    res.innerHTML = '<div class="empty" style="text-align:left">'
      + '<b>Aucun miroir Overpass n\'a r\u00e9pondu.</b><br><br>'
      + (e.detail||[e.message]).map(x => '&bull; ' + esc(x)).join('<br>')
      + '<br><br><span style="color:var(--txt3)">Un quota atteint se d\u00e9bloque seul '
      + 'en quelques minutes. Un d\u00e9lai d\u00e9pass\u00e9 se corrige en r\u00e9duisant le rayon.</span></div>';
  }
}

async function telechargerIdx(i){
  const g = (window.__osmRes || [])[i]; if(!g) return;
  const rayon = parseInt(document.getElementById('osm-rayon').value, 10) || RAYON_DEFAUT;
  try{
    const rec = await telechargerGare(g, rayon);
    document.getElementById('osm-res').innerHTML = '';
    document.getElementById('osm-q').value = '';
    await renderOSM();
    toast(rec.nom + ' \u2014 ' + Math.round(rec.taille/1024) + ' Ko enregistr\u00e9s','g');
  }catch(e){
    console.error('[OSM] telechargement', e.detail || e);
    toast('\u00c9chec du t\u00e9l\u00e9chargement \u2014 voir le d\u00e9tail','r');
    document.getElementById('osm-res').innerHTML =
      '<div class="empty" style="text-align:left">' + (e.detail||[e.message]).map(x=>'&bull; '+esc(x)).join('<br>') + '</div>';
  }
}

async function chargerGare(slug){
  const rec = await osmGet(slug); if(!rec) return;
  goTab('terrain');
  setTimeout(() => {
    afficherGare(rec);
    MAP.setView([rec.lat, rec.lon], 17.5);
  }, 180);
}

async function supprimerGare(slug){
  if(!confirm('Supprimer les donn\u00e9es OSM de cette gare ?')) return;
  if(OSM_ACTIVE && OSM_ACTIVE.slug === slug) masquerOSM(), OSM_ACTIVE = null;
  await osmDel(slug); await renderOSM();
  toast('Supprim\u00e9');
}
