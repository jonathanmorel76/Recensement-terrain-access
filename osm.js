// ══════════════════════════════════════════════════════════════
// osm.js — TickS Terrain
// Reference OSM : reseau pietonnier et noeuds de cheminement, prepares en
// amont par preparer_gares_osm.py et publies dans gares/ avec l'app.
//
// AUCUN APPEL A OVERPASS DEPUIS L'APP.
// Les versions precedentes interrogeaient Overpass au moment ou l'operateur
// en avait besoin. Trois raisons ont fait abandonner ce principe :
//   - Overpass bloque les plages AWS et Azure depuis octobre 2025, donc tout
//     relais deploye sur Vercel est rejete sans code d'erreur ;
//   - l'instance publique est notoirement congestionnee ;
//   - surtout, dependre d'un service benevole a l'instant precis ou l'on se
//     trouve en gare est fragile par nature.
// Les donnees sont preparees au bureau et servies en statique. Si une requete
// a la demande redevenait necessaire, elle serait a traiter cote preparation,
// pas ici : c'est le retour de cette dependance qu'il faut eviter.
//
// PERIMETRE : cheminements, quais, et noeuds qui structurent le graphe
// (ascenseurs, escaliers, traversees, bordures, tourniquets, entrees). Le
// mobilier et l'information voyageur en sont volontairement absents : ils
// relevent du recensement terrain. Deux versions du meme objet, l'une
// observee et l'autre supposee, ne doivent jamais cohabiter sur la carte.
//
// SEPARATION AVEC LES RELEVES : ces donnees ne rejoignent jamais S.waypoints
// ni S.tracks et ne sont jamais synchronisees. Le seul pont est l'adoption
// d'un cheminement comme point de depart d'un trace, que l'operateur valide
// ensuite sommet par sommet.
// ══════════════════════════════════════════════════════════════

const OSM_DB = 'ticks-osm-ref', OSM_VER = 1;
const CATALOGUE = './gares/index.json';

let OSM_LAYER = null;      // couche Leaflet affichee
let OSM_ACTIVE = null;     // gare chargee
let OSM_VISIBLE = false;

// ── Stockage local ────────────────────────────────────────────
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

// ── Correspondance OSM -> taxonomie du projet ─────────────────
// Affiche l'objet dans le vocabulaire de l'operateur plutot qu'en tags OSM :
// « ASCENSEUR » se lit mieux que « highway=elevator » sur un parvis.
function mapperOSM(tags){
  const t = tags || {};
  if(t.highway === 'elevator')                 return ['equip_acces','ASCENSEUR'];
  if(t.highway === 'steps')                    return ['equip_acces', t.conveying && t.conveying!=='no' ? 'ESCALATOR' : 'ESCALIER'];
  if(t.conveying === 'yes' && t.highway)       return ['equip_acces','TAPIS_ROULANT'];
  if(t.highway === 'crossing')                 return ['equip_acces','TRAVERSEE_PIETONS'];
  if(t.kerb === 'lowered' || t.barrier === 'kerb') return ['equip_acces','ABAISSEMENT_TROTTOIR'];
  if(t.barrier === 'turnstile')                return ['equip_acces','PASSAGE_SELECTIF'];
  if(t.railway === 'subway_entrance' || t.railway === 'train_station_entrance') return ['entree','PRINCIPALE'];
  if(t.entrance){
    const m = {main:'PRINCIPALE', yes:'SECONDAIRE', service:'SERVICE', emergency:'URGENCE'};
    return ['entree', m[t.entrance] || 'SECONDAIRE'];
  }
  if(t.railway === 'platform' || t.public_transport === 'platform') return ['noeud','ARRET_TC'];
  return ['noeud','INTERSECTION'];
}

// ── Affichage sur la carte ────────────────────────────────────
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
  // La gare affichee est memorisee pour etre rouverte au prochain lancement.
  // Sans cela, l'operateur devait repasser par le catalogue a chaque
  // redemarrage de l'app — geste inutile puisqu'il l'a deja installee.
  try{ localStorage.setItem('ticks_osm_active', rec.slug); }catch(e){}
  toast(rec.nom + ' \u2014 ' + rec.lignes.length + ' cheminements, ' + rec.points.length + ' n\u0153uds');
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

async function toggleOSM(){
  if(OSM_VISIBLE){ masquerOSM(); return; }
  if(OSM_ACTIVE){ afficherGare(OSM_ACTIVE); return; }
  // Derniere gare consultee, si elle est toujours installee : on la reaffiche
  // sans detour par le catalogue.
  let slug = null;
  try{ slug = localStorage.getItem('ticks_osm_active'); }catch(e){}
  if(slug){
    const rec = await osmGet(slug);
    if(rec){ afficherGare(rec); return; }
  }
  goTab('osm');
}

// Restauration au demarrage. La couche n'est reaffichee que si la carte est
// DANS les environs de la gare memorisee : revenu au bureau ou parti sur un
// autre site, l'operateur n'a que faire des cheminements de la veille, et les
// voir surgir a l'autre bout de la region serait deroutant.
async function restaurerOSM(){
  let slug = null;
  try{ slug = localStorage.getItem('ticks_osm_active'); }catch(e){}
  if(!slug || !MAP_OK) return;
  const rec = await osmGet(slug);
  if(!rec) return;
  const c = MAP.getCenter();
  const d = MAP.distance ? MAP.distance(c, L.latLng(rec.lat, rec.lon))
                         : L.latLng(rec.lat, rec.lon).distanceTo(c);
  if(d <= 5000) afficherGare(rec);
}

// ── Adoption d'un cheminement comme trace ─────────────────────
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

// ── Catalogue ─────────────────────────────────────────────────
// UNE seule liste : les gares publiees avec l'app, marquees selon qu'elles
// sont deja installees sur l'appareil. Une gare installee puis retiree du
// catalogue reste visible tant qu'elle est en base locale : la faire
// disparaitre reviendrait a retirer sans prevenir des donnees peut-etre
// utilisees le jour meme sur le terrain.
async function renderOSM(){
  const el = document.getElementById('cat-list');
  if(!el) return;
  el.innerHTML = '<div class="empty">Lecture du catalogue\u2026</div>';

  const locales = await osmList();
  const parSlug = new Map(locales.map(g => [g.slug, g]));

  let idx = null;
  try{
    const r = await fetch(CATALOGUE, {cache:'no-cache'});
    if(r.ok) idx = await r.json();
  }catch(e){ /* catalogue absent : on affiche au moins ce qui est local */ }

  const lignes = [], vus = new Set();
  for(const g of (idx && idx.gares) || []){
    vus.add(g.slug);
    lignes.push(ligneGare(g, parSlug.has(g.slug)));
  }
  for(const g of locales){
    if(!vus.has(g.slug)) lignes.push(ligneGare({
      slug:g.slug, nom:g.nom, nb_lignes:g.lignes.length,
      nb_points:g.points.length, taille:g.taille||0}, true, true));
  }

  const info = document.getElementById('cat-info');
  if(info) info.textContent = idx
    ? ((idx.gares||[]).length + ' gare(s) \u00b7 catalogue du ' + (idx.genere_le||'').slice(0,10))
    : '';

  el.innerHTML = lignes.join('') || '<div class="empty" style="text-align:left">'
    + 'Aucun catalogue publi\u00e9.<br><br><span style="color:var(--txt3)">Lancer '
    + '<code>preparer_gares_osm.py</code> depuis le poste de travail, puis committer '
    + 'le dossier <code>gares/</code> \u00e0 la racine du d\u00e9p\u00f4t.</span></div>';
}

function ligneGare(g, installee, horsCatalogue){
  const coche = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const fleche = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const meta = g.nb_lignes + ' cheminements \u00b7 ' + g.nb_points + ' n\u0153uds \u00b7 '
    + Math.round((g.taille||0)/1024) + ' Ko'
    + (installee ? ' \u00b7 hors ligne' : '')
    + (horsCatalogue ? ' \u00b7 hors catalogue' : '');
  return '<div class="wpt-item">'
    + '<div class="wdot" style="background:' + (installee ? 'rgba(141,198,63,.16);color:#5A9E1B' : 'rgba(138,48,144,.12);color:var(--ticks)') + '">'
    + (installee ? coche : fleche) + '</div>'
    + '<div class="winfo"><div class="wname">' + esc(g.nom) + '</div>'
    + '<div class="wmeta">' + meta + '</div></div>'
    + (installee
        ? '<button class="wbtn" onclick="chargerGare(\'' + g.slug + '\')" style="width:auto;padding:0 12px;font-size:12.5px;font-weight:600;color:var(--ticks)">Ouvrir</button>'
          + '<button class="wbtn" onclick="supprimerGare(\'' + g.slug + '\')" aria-label="Retirer">&times;</button>'
        : '<button class="wbtn" onclick="installerGare(\'' + g.slug + '\')" style="width:auto;padding:0 12px;font-size:12.5px;font-weight:600;color:var(--ticks)">Installer</button>')
    + '</div>';
}

async function installerGare(slug){
  const deja = await osmGet(slug);
  if(deja){ chargerGare(slug); return; }
  try{
    const r = await fetch('./gares/' + slug + '.json', {cache:'no-cache'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const rec = await r.json();
    delete rec.meta;   // redondant une fois en base locale
    await osmPut(rec);
    await renderOSM();
    toast(rec.nom + ' \u2014 ' + Math.round((rec.taille||0)/1024) + ' Ko install\u00e9s','g');
  }catch(e){ toast('\u00c9chec : ' + e.message,'r'); }
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
