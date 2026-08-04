// ========================================
// TickS Terrain — app.js v1.9.0
// GPS, Carte, Capture, UI
// NOTE : le BOOT (load/startGPS/_bootMap) est en fin de sync.js
// car sync.js charge en dernier. Ne PAS le remettre ici.
// NOTE : APP_VERSION ecrase le libelle de index.html au DOMContentLoaded.
// Les deux doivent donc rester synchronises.
// ========================================
const APP_VERSION = '1.9.0';
console.log('[TickS Terrain] app.js v1.9.0 charge');

const S = {
  pos:null, acc:null, gpsHighMode:false,
  waypoints:[], tracks:[],
  recording:false, paused:false,
  curTrack:null,
  recStart:null, recElapsed:0, recTimer:null,
  pendingType:null, pendingPos:null
};
const AVG = { active:false, type:null, samples:[], target:8, maxAcc:20,
              lastTs:0, timer:null, deadline:0, rejected:0 };
// Pointage manuel : MANUAL.pos = coords choisies par appui long sur la carte
// PICK.type = type en attente quand on bascule du moyennage vers la carte
// PICK.armedAt = instant d'activation, sert a filtrer le clic fantome iOS
const MANUAL = { pos:null, marker:null };
const PICK   = { active:false, type:null, armedAt:0 };
let EDIT_ID = null;
let MAP = null, MAP_OK = false;
let MAP_LAYER_OSM = null, MAP_LAYER_AERIAL = null, MAP_AERIAL = false;
const TILE_OSM    = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_AERIAL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
let MAP_LAYERS = [], MAP_REC_LINE = null, MAP_POS = null, MAP_SCALE = null;
// Recadrage au PREMIER fix GPS seulement : _bootMap s'execute ~100 ms apres
// le chargement, bien avant que le GPS ne reponde. Sans ce drapeau la carte
// restait sur la Normandie au zoom 9 jusqu'a ce qu'on touche le bouton de
// geolocalisation. Une fois recadre, on ne bouge plus : l'utilisateur reste
// maitre du deplacement.
let MAP_FIRST_FIX = false;
// Zoom d'ouverture FRACTIONNAIRE (possible grace a zoomSnap:0 ci-dessous).
// 19,3 -> ~0,158 m/pixel, soit ~62 m de large sur un ecran de 390 px.
// VALEUR MESUREE, pas estimee : relevee sur une capture d'ecran de l'app ou
// la barre d'echelle affichait 10 m pour 62,7 px CSS. Ne pas l'arrondir a
// l'entier sans raison, 19 donnerait 76 m et 20 seulement 38 m.
// Historique des reglages essayes :
//   18   = 152 m  trop large pour situer un point
//   19,3 =  62 m  RETENU
//   20   =  38 m  dernier niveau NATIF de l'orthophoto IGN
//   21   =  19 m  trop serre a l'usage
// maxNativeZoom sur les couches evite les requetes de tuiles inexistantes
// (OSM s'arrete au 19, l'IGN au 20) : sans lui, des carres gris.
const ZOOM_LEVE = 19.3;
let MAP_FILTER = 'all';
// SOURCE UNIQUE des couleurs de type. Toute vue (boutons de capture, marqueurs
// carte, liste, filtre, fenetre d'edition) lit ici : plus de valeur en dur.
// Teintes choisies pour rester distinguables sur une pastille de 22 px en
// plein soleil. L'ancienne palette avait 13 deg d'ecart entre equip_acces et
// autre, et 24 entre equip_comp et noeud : indiscernable a bout de bras.
// 'autre' est volontairement DESATURE : l'absence de couleur traduit le
// « a classifier », et libere une teinte pour les vraies categories.
const COLORS = {
  entree:      '#9333EA',  // violet   271 deg
  equip_comp:  '#0891B2',  // cyan     192 deg
  equip_acces: '#EA580C',  // orange    21 deg
  noeud:       '#2563EB',  // bleu     221 deg
  autre:       '#64748B'   // ardoise  desature
};

// SOURCE UNIQUE des pictogrammes. Contenu interne d'un SVG 24x24, trace en
// currentColor : la couleur est donnee par l'element parent, ce qui permet de
// reutiliser le meme glyphe en blanc sur un marqueur et en couleur ailleurs.
const ICONS = {
  entree:      '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  equip_comp:  '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  equip_acces: '<rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="10" x2="12" y2="16"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
  noeud:       '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>',
  autre:       '<circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>'
};

function typeSvg(type,size,color,sw){
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" '
    +'stroke="currentColor" stroke-width="'+(sw||1.7)+'" stroke-linecap="round" '
    +'stroke-linejoin="round" style="color:'+(color||COLORS[type]||'#888')+';display:block">'
    +(ICONS[type]||'')+'</svg>';
}

// Applique couleur et pictogramme a tout element portant data-t. Appele au
// boot : les vues statiques d'index.html n'ont donc plus a dupliquer ni les
// SVG ni les couleurs.
function paintTypeUI(){
  document.querySelectorAll('[data-t]').forEach(el=>{
    const t=el.dataset.t, c=COLORS[t]||'#888';
    el.style.setProperty('--tc', c);
    const dot=el.querySelector('.fdot');
    if(dot){dot.style.background=c;return;}
    const slot=el.querySelector('.wi')||el.querySelector('.ti');
    if(!slot)return;
    const wi=slot.classList.contains('wi');
    slot.innerHTML=typeSvg(t, wi?20:22, c, wi?1.7:1.6);
    if(wi){
      el.style.borderColor=c+'59';
      // La teinte se SUPERPOSE au fond opaque, elle ne le remplace pas.
      // Avec el.style.background=c+'12' on ecrasait var(--c-glass) : le
      // bouton n'avait plus qu'un voile a 7 % d'opacite et laissait
      // transparaitre la carte, illisible sur l'orthophoto.
      // La couche de couleur passe donc en background-IMAGE, et
      // var(--c-glass2) (0,95 d'opacite) reste en background-COLOR. La
      // variable est resolue dans le contexte de l'element, donc le mode
      // sombre suit sans code supplementaire.
      el.style.background='linear-gradient('+c+'1F,'+c+'1F), var(--c-glass2)';
      const lab=el.querySelector('.wl');
      if(lab) lab.style.color=c;   // libelle a la couleur du type, plus lisible
    }
  });
}
const SUBS = {
  entree:     ['PRINCIPALE','SECONDAIRE','SERVICE','URGENCE','QUAI','AUTRE'],
  equip_comp: ['BORNE_INFO','PLAN_TACTILE','ANNONCE_SONORE','DISTRIBUTEUR_TITRES','SIGNALETIQUE_VISUELLE','AFFICHEUR_QUAI','AUTRE'],
  equip_acces:['ESCALIER','ASCENSEUR','RAMPE_ACCES','TRAVERSEE_PIETONS','ABAISSEMENT_TROTTOIR','RESSAUT','AUTRE'],
  noeud:      ['INTERSECTION','CARREFOUR','ENTREE_ERP','ARRET_TC','AUTRE'],
  autre:      ['A_CLASSIFIER','OBSTACLE','REMARQUE','PHOTO_REF']
};

// ══ GPS ══
let GPS_WATCH_ID = null;
let GPS_LAST_MAP = 0;

function startGPS(){
  if(!navigator.geolocation){toast('GPS non disponible','r');return;}
  const bar=document.getElementById('gps-bar-txt');
  if(bar) bar.textContent='Recherche…';
  launchWatch(isIOS16Plus()||isAndroidModern());
}
function isIOS16Plus(){const m=navigator.userAgent.match(/OS (\d+)_/);return /iPhone|iPad|iPod/.test(navigator.userAgent)&&m&&parseInt(m[1])>=16;}
function isAndroidModern(){const m=navigator.userAgent.match(/Android (\d+)/);return /Android/.test(navigator.userAgent)&&m&&parseInt(m[1])>=10;}

function launchWatch(highAccuracy){
  if(GPS_WATCH_ID!==null){navigator.geolocation.clearWatch(GPS_WATCH_ID);GPS_WATCH_ID=null;}
  GPS_WATCH_ID=navigator.geolocation.watchPosition(
    pos=>{
      S.pos={lat:pos.coords.latitude,lon:pos.coords.longitude};
      S.acc=Math.round(pos.coords.accuracy);
      updateGpsBar(S.acc);
      if(MAP_OK && !MAP_FIRST_FIX){
        MAP_FIRST_FIX=true;
        MAP.setView([S.pos.lat,S.pos.lon], ZOOM_LEVE);
      }
      const now=Date.now(),throttle=(S.recording&&!S.paused)?2000:5000;
      if(MAP_OK&&S.pos&&(now-GPS_LAST_MAP)>throttle){
        GPS_LAST_MAP=now;
        if(MAP_POS){try{MAP.removeLayer(MAP_POS);}catch(e){}}
        MAP_POS=L.marker([S.pos.lat,S.pos.lon],{icon:mkPosIcon(),zIndexOffset:1000}).addTo(MAP);
      }
      // Filtre de distance : a l'arret le GPS "derive" et gonflait la longueur
      // du troncon de plusieurs dizaines de metres. On ignore les points a
      // moins de 2 m du precedent.
      if(S.recording&&!S.paused&&S.acc<=15){
        const t=S.tracks[S.curTrack];
        const prev=t.pts[t.pts.length-1];
        if(!prev||hav(prev,S.pos)>=2){
          t.pts.push({lat:S.pos.lat,lon:S.pos.lon,ts:Date.now(),acc:S.acc});
          updateTrkStats();updateMapLive();
        }
      }
      // Dedoublonnage : watchPosition peut renvoyer plusieurs fois le MEME fix.
      // Sans ce test, "8 mesures" pouvait etre 8 copies d'une seule position.
      if(AVG.active&&S.acc<=AVG.maxAcc&&pos.timestamp!==AVG.lastTs){
        AVG.lastTs=pos.timestamp;
        AVG.samples.push({lat:S.pos.lat,lon:S.pos.lon,acc:S.acc});
        updateAvgUI();
        if(AVG.samples.length>=AVG.target)commitAvg();
      }
    },
    err=>{
      const bar=document.getElementById('gps-bar-txt');
      if(bar){bar.textContent='GPS err';bar.style.color='var(--red,#FF3B30)';}
      if(err.code===1)toast(/iPhone|iPad|iPod/.test(navigator.userAgent)?'Autorisez la localisation dans R\u00e9glages Safari':'Permission GPS refus\u00e9e','r');
      else if(err.code===3)toast('GPS timeout \u2014 allez \u00e0 l\'ext\u00e9rieur','a');
    },
    highAccuracy?{enableHighAccuracy:true,timeout:15000,maximumAge:0}
      :(isIOS16Plus()||isAndroidModern())?{enableHighAccuracy:true,timeout:20000,maximumAge:3000}
      :{enableHighAccuracy:false,timeout:30000,maximumAge:8000}
  );
}
function adaptGPS(){
  const needHigh=(S.recording&&!S.paused)||AVG.active,isHigh=S.gpsHighMode||false;
  if(needHigh&&!isHigh){S.gpsHighMode=true;launchWatch(true);}
  if(!needHigh&&isHigh){S.gpsHighMode=false;launchWatch(false);}
}
function gotoGPS(){if(!S.pos){toast('Position GPS inconnue','a');return;}MAP.setView([S.pos.lat,S.pos.lon],ZOOM_LEVE);}
function updateGpsBar(acc){
  const bar=document.getElementById('gps-bar-txt');
  const fill=document.getElementById('gps-bar-fill');
  const btn=document.getElementById('btn-geolocate');
  if(!bar)return;
  const col = acc<=5 ? 'var(--green,#34C759)'
            : acc<=15 ? 'var(--orange,#FF9F0A)'
            : 'var(--red,#FF3B30)';
  bar.textContent='\u00b1'+acc+'m';
  bar.style.color=col;
  // Jauge de qualite : pleine a 3 m ou mieux, vide a 30 m ou pire.
  // Cet element existait dans le HTML depuis le debut mais AUCUNE ligne de
  // JavaScript ne lui donnait de largeur : il restait fige a 0 %, ce qui le
  // rendait inutile. Il suit desormais la precision en largeur et en
  // couleur, et redonne la lecture de la progression du signal.
  if(fill){
    const q=Math.max(0,Math.min(100,Math.round(100*(30-acc)/27)));
    fill.style.width=q+'%';
    fill.style.background=col;
  }
  if(btn)btn.classList.toggle('tracking',acc<=15);
}

// ══ CARTE ══
function initMap(){
  if(!MAP_OK){
    // zoomSnap:0 autorise les niveaux FRACTIONNAIRES. Sans cela Leaflet
    // arrondit a l'entier le plus proche : ni le zoom d'ouverture a 19,3 ni
    // le pas de 10 m des boutons +/- ne seraient possibles.
    MAP=L.map('map',{zoomControl:false,attributionControl:true,zoomSnap:0});
    MAP_LAYER_OSM=L.tileLayer(TILE_OSM,{attribution:'\u00a9 <a href="https://openstreetmap.org">OSM</a>',maxNativeZoom:19,maxZoom:21}).addTo(MAP);
    MAP_LAYER_AERIAL=L.tileLayer(TILE_AERIAL,{attribution:'\u00a9 IGN G\u00e9oplateforme',maxNativeZoom:20,maxZoom:21});
    MAP.setView([49.18,0.35],9);

    // Echelle a paliers FINS. Leaflet ne propose que 1, 2 et 5 fois une
    // puissance de dix : entre 10 et 20 m il n'a rien a offrir, la barre
    // reste donc courte et le metrage saute grossierement. On intercale
    // 1,5 / 2,5 / 3 / 4 / 7,5 pour qu'elle colle a l'echelle reelle et
    // occupe mieux la largeur disponible — utile maintenant que le zoom
    // est fractionnaire et peut tomber n'importe ou.
    const ScaleFine = L.Control.Scale.extend({
      _getRoundNum: function(num){
        const pow10 = Math.pow(10, String(Math.floor(num)).length - 1);
        let d = num / pow10;
        d = d>=10 ? 10 : d>=7.5 ? 7.5 : d>=5 ? 5 : d>=4 ? 4
          : d>=3 ? 3 : d>=2.5 ? 2.5 : d>=2 ? 2 : d>=1.5 ? 1.5 : 1;
        return pow10 * d;
      }
    });
    // Echelle en bas-GAUCHE : seul coin durablement libre. Le haut-gauche a la
    // barre GPS, le haut-droit la pilule, le milieu-gauche les boutons de
    // capture, le bas-droit l'attribution et le bouton de geolocalisation.
    // Fond opaque et trait sombre pour rester lisible sur l'orthophoto.
    MAP_SCALE=new ScaleFine({position:'bottomleft',metric:true,imperial:false,maxWidth:120}).addTo(MAP);
    const sc=MAP_SCALE.getContainer();
    if(sc){
      sc.style.margin='0 0 10px 12px';
      const line=sc.querySelector('.leaflet-control-scale-line');
      if(line){
        line.style.background='rgba(255,255,255,.92)';
        line.style.border='1px solid rgba(0,0,0,.45)';
        line.style.borderTop='none';
        line.style.color='rgba(0,0,0,.82)';
        line.style.fontSize='10px';
        line.style.fontWeight='600';
        line.style.padding='1px 5px';
        line.style.borderRadius='0 0 3px 3px';
      }
    }
    MAP_OK=true;
    if(S.pos){MAP_FIRST_FIX=true;MAP.setView([S.pos.lat,S.pos.lon],ZOOM_LEVE);}
  }
  refreshMap();
  setTimeout(()=>{if(MAP)MAP.invalidateSize();},150);
}

// ══ ZOOM PAR PAS METRIQUE ══
// Le zoom Leaflet est exponentiel : passer du niveau 20 au 21 divise la
// largeur affichee par deux. Un pas CONSTANT de 10 m n'existe donc pas en
// niveaux entiers. On calcule la largeur courante en metres, on retranche
// (ou ajoute) 10 m, puis on repasse en niveau de zoom par un logarithme.
const PAS_ZOOM_M = 10;

function largeurCarteM(){
  const el=document.getElementById('map');
  const px=(el&&el.clientWidth)||390;
  const lat=MAP.getCenter().lat*Math.PI/180;
  const mpp=156543.03392*Math.cos(lat)/Math.pow(2,MAP.getZoom());
  return mpp*px;
}

// deltaM > 0 : on resserre (zoom avant). deltaM < 0 : on elargit.
function stepZoom(deltaM){
  if(!MAP_OK)return;
  const w=largeurCarteM();
  // Plancher a 5 m : en dessous l'image n'est plus qu'un aplat de pixels
  // agrandis. Plafond a 4 km : au-dela on perd le contexte du site.
  const cible=Math.max(5, Math.min(4000, w-deltaM));
  const z=MAP.getZoom()+Math.log2(w/cible);
  MAP.setZoom(Math.max(3, Math.min(21, z)));
}

// Les boutons sont injectes dans #right-pill plutot qu'ecrits dans
// index.html : le pas metrique et le rendu restent ainsi definis au meme
// endroit que la logique de zoom. Ce sont des FRERES flex des boutons
// existants, donc aucun risque de chevauchement.
function addZoomButtons(){
  const pill=document.getElementById('right-pill');
  if(!pill||document.getElementById('btn-zoom-in'))return;
  const svg=d=>'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" '
    +'stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'+d+'</svg>';
  [['btn-zoom-in','<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',PAS_ZOOM_M,'Zoom avant'],
   ['btn-zoom-out','<line x1="5" y1="12" x2="19" y2="12"/>',-PAS_ZOOM_M,'Zoom arriere']
  ].forEach(([id,path,delta,label])=>{
    const sep=document.createElement('div');
    sep.className='rpill-sep';
    pill.appendChild(sep);
    const b=document.createElement('button');
    b.id=id; b.className='rpill-btn'; b.setAttribute('aria-label',label);
    b.innerHTML=svg(path);
    b.addEventListener('click',()=>stepZoom(delta));
    pill.appendChild(b);
    if(typeof L!=='undefined'&&L.DomEvent){
      L.DomEvent.disableClickPropagation(b);
    }
  });
}

// ══ POINTAGE MANUEL SUR LA CARTE ══
// Indispensable en gare couverte / sous marquise, la ou le GPS ne descend
// jamais sous 20 m. Deux entrees :
//   A. appui long sur la carte  -> position choisie, puis type via les boutons
//   B. bouton "Pointer sur la carte" pendant un leve -> type deja connu
function bindMapPicking(){
  if(!MAP)return;
  // Leaflet emet 'contextmenu' sur appui long tactile ET clic droit desktop
  MAP.on('contextmenu', e=>{
    if(PICK.active)return;
    setManual(e.latlng.lat, e.latlng.lng);
  });
  MAP.on('click', e=>{
    if(!PICK.active)return;
    // Garde anti "clic fantome". Sur iOS, le tap qui ferme la fenetre de
    // leve produit ensuite un click synthetique sur l'element situe dessous,
    // c'est-a-dire la carte. Sans ce delai, ce clic parasite consommait
    // immediatement le mode pointage et posait le point a l'aplomb du
    // bouton : une fiche surgissait a une position aberrante, l'utilisateur
    // l'annulait, et le mode etait deja termine — plus rien ne repondait
    // ensuite. D'ou l'impression que le bouton ne servait a rien.
    if(Date.now()-PICK.armedAt < 500){
      console.warn('[TickS] Clic fantome ignore (', Date.now()-PICK.armedAt, 'ms )');
      return;
    }
    const type=PICK.type;
    endPick();
    S.pendingType=type;
    S.pendingPos={lat:e.latlng.lat,lon:e.latlng.lng,acc:0,source:'manuel'};
    openWptModal(type,e.latlng.lat,e.latlng.lng,0);
  });
}

// A. Appui long : on memorise la position, l'utilisateur choisit le type
function setManual(lat,lon){
  clearManual();
  PICK.armedAt=Date.now();
  MANUAL.pos={lat,lon};
  if(MAP){
    MANUAL.marker=L.marker([lat,lon],{icon:manualIcon()}).addTo(MAP);
  }
  showBar('manual-bar');
  toast('Position choisie \u2014 s\u00e9lectionnez le type','a');
}
function clearManual(){
  if(MANUAL.marker&&MAP){try{MAP.removeLayer(MANUAL.marker);}catch(e){}}
  MANUAL.marker=null;MANUAL.pos=null;
  hideBar('manual-bar');
}

// B. Bascule depuis le leve GPS : le type est deja choisi
function startPick(type){
  if(!type){toast('Choisissez d\'abord un type','a');return;}
  PICK.active=true;PICK.type=type;
  PICK.armedAt=Date.now();
  clearManual();
  showBar('pick-bar');
  const el=document.getElementById('map');
  if(el)el.classList.add('picking');
}
function endPick(){
  PICK.active=false;PICK.type=null;
  hideBar('pick-bar');
  const el=document.getElementById('map');
  if(el)el.classList.remove('picking');
}
function cancelPick(){endPick();toast('Pointage annul\u00e9','a');}

// Bouton de la fenetre de moyennage : "Pointer sur la carte"
function pickFromAvg(){
  const type=AVG.type||S.pendingType;
  cancelAvg();
  startPick(type);
}

function showBar(id){const b=document.getElementById(id);if(b)b.classList.add('open');}
function hideBar(id){const b=document.getElementById(id);if(b)b.classList.remove('open');}
function manualIcon(){
  return L.divIcon({className:'',iconSize:[26,26],iconAnchor:[13,13],
    html:'<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="#8A3090" stroke-width="2.5" stroke-dasharray="4 3"/><circle cx="13" cy="13" r="3" fill="#8A3090"/></svg>'});
}
function resizeMap(){
  const el=document.getElementById('map'),sheet=document.getElementById('sheet');
  if(!el||!sheet)return;
  el.style.height=(window.innerHeight-(sheet.offsetHeight||130))+'px';
}
function refreshMap(){
  if(!MAP_OK)return;
  MAP_LAYERS.forEach(l=>{try{MAP.removeLayer(l);}catch(e){}});
  MAP_LAYERS=[];
  const show=MAP_FILTER==='all'?Object.keys(COLORS):[MAP_FILTER];
  S.waypoints.filter(w=>show.includes(w.type)).forEach(w=>{
    const m=L.marker([w.lat,w.lon],{icon:wptIcon(w.type,w.source==='manuel')}).addTo(MAP);
    m.bindPopup('<b>'+esc(w.name)+'</b><br><small>'+(w.subtype||w.type)+(w.source==='manuel'?' \u00b7 point\u00e9 manuellement':'')+'</small>');
    MAP_LAYERS.push(m);
  });
  S.tracks.forEach(t=>{
    if(!t.pts||t.pts.length<2)return;
    MAP_LAYERS.push(L.polyline(t.pts.map(p=>[p.lat,p.lon]),{color:'#4ade80',weight:3,opacity:.85}).addTo(MAP));
  });
}
// Les points pointes manuellement ont un contour pointille : sur le terrain
// on doit pouvoir distinguer d'un coup d'oeil ce qui vient du GPS.
function wptIcon(type,manual){
  const c=COLORS[type]||'#888';
  const dash=manual?' stroke-dasharray="3 2.5"':'';
  // Le glyphe est le MEME que celui des boutons, reduit de moitie et centre
  // dans la pastille : on reconnait le type sans avoir a memoriser un code
  // couleur.
  const g='<g transform="translate(7,7) scale(0.5)" fill="none" stroke="#fff" '
        +'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" '
        +'style="color:#fff">'+(ICONS[type]||'')+'</g>';
  return L.divIcon({
    html:'<svg xmlns="http://www.w3.org/2000/svg" width="26" height="33" viewBox="0 0 26 33">'
      +'<line x1="13" y1="22" x2="13" y2="32" stroke="'+c+'" stroke-width="2.5"/>'
      +'<circle cx="13" cy="13" r="11.5" fill="'+c+'" stroke="#fff" stroke-width="2"'+dash+'/>'
      +g+'</svg>',
    iconSize:[26,33],iconAnchor:[13,33],popupAnchor:[0,-33],className:''});
}
function mkPosIcon(){return L.divIcon({html:'<div style="width:14px;height:14px;border-radius:50%;background:#007AFF;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,255,.4)"></div>',iconSize:[14,14],iconAnchor:[7,7],className:''});}
function updateMapLive(){
  if(!MAP_OK||!S.recording)return;
  const t=S.tracks[S.curTrack];
  if(!t||t.pts.length<2)return;
  if(MAP_REC_LINE)try{MAP.removeLayer(MAP_REC_LINE);}catch(e){}
  MAP_REC_LINE=L.polyline(t.pts.map(p=>[p.lat,p.lon]),{color:'#4ade80',weight:3}).addTo(MAP);
}
function toggleLayer(){
  MAP_AERIAL=!MAP_AERIAL;
  if(MAP_AERIAL){MAP.removeLayer(MAP_LAYER_OSM);MAP_LAYER_AERIAL.addTo(MAP);}
  else{MAP.removeLayer(MAP_LAYER_AERIAL);MAP_LAYER_OSM.addTo(MAP);}
  const btn=document.getElementById('btn-layer');
  if(btn)btn.style.color=MAP_AERIAL?'var(--ticks,#8A3090)':'';
}
function applyFilter(f,btn){
  MAP_FILTER=f;
  document.querySelectorAll('#filter-popover button').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  refreshMap();
  closeFilterPopover();
}

// ══ CAPTURE ══
function startCapture(type){
  // Cas 1 : l'utilisateur a fait un appui long sur la carte -> position deja
  // choisie manuellement, on saute entierement le moyennage GPS.
  if(MANUAL.pos){
    const p=MANUAL.pos;
    S.pendingType=type;
    S.pendingPos={lat:p.lat,lon:p.lon,acc:0,source:'manuel'};
    clearManual();
    openWptModal(type,p.lat,p.lon,0);
    return;
  }
  // Cas 2 : leve GPS classique
  if(!S.pos){toast('GPS non disponible \u2014 pointez sur la carte','a');startPick(type);return;}
  S.pendingType=type;S.pendingPos={lat:S.pos.lat,lon:S.pos.lon,acc:S.acc};
  AVG.active=true;AVG.type=type;AVG.samples=[];AVG.target=8;AVG.maxAcc=20;
  AVG.lastTs=0;AVG.rejected=0;
  AVG.deadline=Date.now()+30000;
  stopAvgTimer();AVG.timer=setInterval(avgTick,1000);avgTick();
  adaptGPS();requestWakeLock();
  const t=document.getElementById('avg-title');
  if(t)t.textContent='Lev\u00e9 '+typeLabel(type);
  document.getElementById('avg-prog-fill').style.width='0%';
  document.getElementById('avg-n').textContent='0/8';
  document.getElementById('avg-acc').textContent='\u00b1\u2014 m';
  const fb=document.getElementById('avg-force');
  if(fb){fb.disabled=true;fb.style.opacity='.4';}
  document.getElementById('avg-modal').classList.add('open');
}
function typeLabel(t){return {entree:'Entr\u00e9e',equip_comp:'Info voy.',equip_acces:'Equip.acc\u00e8s',noeud:'N\u0153ud',autre:'Autre'}[t]||t;}
function updateAvgUI(){
  const n=AVG.samples.length,tgt=AVG.target,pct=Math.min(100,Math.round(n/tgt*100));
  document.getElementById('avg-prog-fill').style.width=pct+'%';
  document.getElementById('avg-n').textContent=n+'/'+tgt;
  const acc=AVG.samples.length?Math.round(AVG.samples.reduce((s,p)=>s+p.acc,0)/AVG.samples.length):0;
  document.getElementById('avg-acc').textContent='\u00b1'+acc+'m';
  const fb=document.getElementById('avg-force');
  if(fb&&n>=3&&fb.disabled){fb.disabled=false;fb.style.opacity='1';}
}
function forceAvg(){if(AVG.samples.length>=3)commitAvg();}
function cancelAvg(){
  stopAvgTimer();
  AVG.active=false;AVG.samples=[];AVG.lastTs=0;
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS();releaseWakeLock();
}
function commitAvg(){
  stopAvgTimer();
  let pts=AVG.samples.slice();
  if(!pts.length){cancelAvg();return;}

  // 1) Centre provisoire (non pondere) pour detecter les aberrants
  const cx={lat:pts.reduce((a,p)=>a+p.lat,0)/pts.length,
            lon:pts.reduce((a,p)=>a+p.lon,0)/pts.length};

  // 2) Rejet des aberrants : un seul saut GPS suffisait a decaler le point.
  //    Seuil = 3x la distance mediane au centre (plancher 5 m).
  let rejected=0;
  if(pts.length>=5){
    const d=pts.map(p=>hav(cx,p)).sort((a,b)=>a-b);
    const med=d[Math.floor(d.length/2)]||0;
    const seuil=Math.max(med*3,5);
    const kept=pts.filter(p=>hav(cx,p)<=seuil);
    if(kept.length>=3){rejected=pts.length-kept.length;pts=kept;}
  }

  // 3) Moyenne ponderee par 1/precision^2 : un fix a +/-3 m pese ~44x plus
  //    qu'un fix a +/-20 m. La moyenne simple les traitait a egalite.
  let W=0,sLat=0,sLon=0;
  pts.forEach(p=>{const w=1/Math.pow(Math.max(p.acc,1),2);W+=w;sLat+=p.lat*w;sLon+=p.lon*w;});
  const lat=sLat/W, lon=sLon/W;

  // 4) Precision resultante.
  //    L'ancienne formule divisait par racine(N), ce qui suppose des erreurs
  //    INDEPENDANTES entre mesures. C'est faux ici : des fixes pris a
  //    quelques secondes d'intervalle partagent la meme geometrie
  //    satellitaire et les memes reflexions, donc une large part de l'erreur
  //    est COMMUNE et le moyennage ne l'elimine pas. Le chiffre annonce
  //    etait donc flatteur, et pouvait faire passer pour un leve a +/-3 m ce
  //    qui restait a +/-8 m.
  //    Deux garde-fous remplacent la division libre :
  //      a) la dispersion reelle des mesures retenues autour du point final,
  //         qui est une borne basse OBSERVEE de l'incertitude ;
  //      b) un plafond de gain a 2x, le moyennage ne corrigeant que la part
  //         aleatoire de l'erreur.
  //    On annonce le plus pessimiste des deux. Calibrage a affiner sur des
  //    releves terrain compares a des points de reference connus.
  const accMoy=pts.reduce((a,p)=>a+p.acc,0)/pts.length;
  const disp=Math.sqrt(pts.reduce((a,p)=>a+Math.pow(hav({lat,lon},p),2),0)/pts.length);
  const gain=Math.min(Math.sqrt(pts.length),2);
  const acc=Math.max(1,Math.round(Math.max(accMoy/gain, disp)));

  AVG.active=false;AVG.samples=[];AVG.lastTs=0;
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS();releaseWakeLock();
  S.pendingPos={lat,lon,acc,n:pts.length,source:'gps'};
  if(rejected>0)toast(rejected+' mesure(s) aberrante(s) ecart\u00e9e(s)','a');
  openWptModal(AVG.type||S.pendingType,lat,lon,acc);
}

// Compte a rebours : sans cela, si la precision ne passait jamais sous le
// seuil, la fenetre de capture restait ouverte indefiniment.
function stopAvgTimer(){if(AVG.timer){clearInterval(AVG.timer);AVG.timer=null;}}
function avgTick(){
  const reste=Math.ceil((AVG.deadline-Date.now())/1000);
  const el=document.getElementById('avg-timer');
  if(el)el.textContent=reste>0?reste+' s':'';
  if(reste>0)return;
  stopAvgTimer();
  if(AVG.samples.length>=3){toast('D\u00e9lai atteint \u2014 moyenne sur '+AVG.samples.length+' mesures','a');commitAvg();}
  else{
    const type=AVG.type||S.pendingType;
    cancelAvg();
    toast('GPS insuffisant \u2014 pointez sur la carte','r');
    startPick(type);
  }
}
function openWptModal(type,lat,lon,acc){
  document.getElementById('wm-title').textContent='Point \u2014 '+typeLabel(type);
  const p=S.pendingPos||{};
  const origine = p.source==='manuel'
      ? ' \u00b7 point\u00e9 sur la carte'
      : (acc? ' \u00b7 \u00b1'+acc+'m'+(p.n?' ('+p.n+' mesures)':'') : '');
  document.getElementById('wm-coords').textContent=lat.toFixed(5)+', '+lon.toFixed(5)+origine;
  document.getElementById('wm-name').value='';
  document.getElementById('wm-sub').innerHTML=(SUBS[type]||['AUTRE']).map(v=>'<option>'+v+'</option>').join('');
  document.getElementById('wm-desc').value='';
  document.getElementById('wpt-modal').classList.add('open');
}
function closeWptModal(){document.getElementById('wpt-modal').classList.remove('open');}
function saveWpt(){
  const pos=S.pendingPos||S.pos;
  if(!pos){toast('Pas de position','r');return;}
  const type=S.pendingType||'autre';
  const name=document.getElementById('wm-name').value.trim()||typeLabel(type)+' '+(S.waypoints.length+1);
  const subtype=document.getElementById('wm-sub').value;
  const desc=document.getElementById('wm-desc').value.trim();
  S.waypoints.push({id:crypto.randomUUID?crypto.randomUUID():'wp-'+Date.now(),type,subtype,name,desc,
    lat:pos.lat,lon:pos.lon,acc:pos.acc||0,samples:pos.n||null,
    source:pos.source||'gps',ts:Date.now()});
  closeWptModal();S.pendingType=null;S.pendingPos=null;
  refreshMap();save();
  toast('\u2713 Point enregistr\u00e9','g');
}

// ══ LISTE POINTS ══
function renderPts(){
  const el=document.getElementById('pts-list');
  const all=[...S.waypoints.map(w=>({...w,_k:'w'})),...S.tracks.map((t,i)=>({...t,_k:'t',_i:i}))].sort((a,b)=>(a.ts||a.startTs)-(b.ts||b.startTs));
  if(!all.length){el.innerHTML='<div class="empty">Aucun point enregistr\u00e9.<br>Allez dans Terrain pour commencer.</div>';return;}
  el.innerHTML=all.map(obj=>{
    if(obj._k==='w'){
      const c=COLORS[obj.type]||'#888';
      return '<div class="wpt-item" style="border-color:'+c+'40"><div class="wdot" style="background:'+c+'1A">'+typeSvg(obj.type,17,c)+'</div><div class="winfo" onclick="editWpt(\''+obj.id+'\')" style="cursor:pointer"><div class="wname">'+esc(obj.name)+'</div><div class="wmeta">'+obj.lat.toFixed(5)+', '+obj.lon.toFixed(5)+' \u00b7 '+(obj.subtype||obj.type)+(obj.source==='manuel'?' \u00b7 manuel':(obj.acc?' \u00b7 \u00b1'+obj.acc+'m':''))+'</div>'+(obj.desc?'<div class="wdesc">'+esc(obj.desc)+'</div>':'')+'</div><button class="wbtn" onclick="delWpt(\''+obj.id+'\')">&times;</button></div>';
    }else{
      const d=obj.pts&&obj.pts.length>=2?Math.round(obj.pts.reduce((s,p,i)=>i?s+hav(obj.pts[i-1],p):0,0)):0;
      return '<div class="wpt-item" style="border-color:#4ade8055"><div class="wdot" style="background:#4ade8020;color:#4ade80"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17 Q8 7 12 12 Q16 17 21 7"/></svg></div><div class="winfo"><div class="wname">'+esc(obj.name)+'</div><div class="wmeta">'+(obj.pts?obj.pts.length:0)+' pts \u00b7 '+d+' m</div></div><button class="wbtn" onclick="delTrk('+obj._i+')">&times;</button></div>';
    }
  }).join('');
}
function delWpt(id){if(!confirm('Supprimer ?'))return;S.waypoints=S.waypoints.filter(w=>w.id!==id);renderPts();save();}
function delTrk(i){if(!confirm('Supprimer ?'))return;S.tracks.splice(i,1);renderPts();save();}
function editWpt(id){
  const w=S.waypoints.find(x=>x.id===id);if(!w)return;
  EDIT_ID=id;
  document.getElementById('em-coords').textContent=w.lat.toFixed(6)+', '+w.lon.toFixed(6)+(w.source==='manuel'?' \u00b7 point\u00e9 sur la carte':(w.acc?' \u00b7 \u00b1'+w.acc+'m':''));
  document.querySelectorAll('#em-types .topt').forEach(el=>el.classList.toggle('sel',el.dataset.t===w.type));
  document.getElementById('em-sub').innerHTML=(SUBS[w.type]||['AUTRE']).map(v=>'<option '+(v===w.subtype?'selected':'')+'>'+v+'</option>').join('');
  document.getElementById('em-name').value=w.name||'';
  document.getElementById('em-desc').value=w.desc||'';
  document.getElementById('edit-modal').classList.add('open');
}
function pickType(t,el){
  document.querySelectorAll('#em-types .topt').forEach(e=>e.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById('em-sub').innerHTML=(SUBS[t]||['AUTRE']).map(v=>'<option>'+v+'</option>').join('');
}
function closeEditModal(){document.getElementById('edit-modal').classList.remove('open');EDIT_ID=null;}
function saveEdit(){
  if(!EDIT_ID)return;
  const i=S.waypoints.findIndex(x=>x.id===EDIT_ID);if(i<0)return;
  const t=document.querySelector('#em-types .topt.sel')?.dataset.t||S.waypoints[i].type;
  S.waypoints[i]={...S.waypoints[i],type:t,subtype:document.getElementById('em-sub').value,name:document.getElementById('em-name').value.trim()||S.waypoints[i].name,desc:document.getElementById('em-desc').value.trim()};
  closeEditModal();renderPts();refreshMap();save();toast('Modifi\u00e9','g');
}

// ══ TRONCONS ══
function toggleRec(){
  if(!S.recording){
    S.recording=true;S.paused=false;S.curTrack=S.tracks.length;
    S.tracks.push({name:'Tron\u00e7on '+(S.tracks.length+1),pts:[],startTs:Date.now()});
    S.recStart=Date.now();S.recElapsed=0;
    S.recTimer=setInterval(updateRecTimer,1000);
    adaptGPS();requestWakeLock();updateSheetUI();
    toast('Enregistrement d\u00e9marr\u00e9','g');
  }else{
    S.recording=false;S.paused=false;
    clearInterval(S.recTimer);S.recTimer=null;
    adaptGPS();releaseWakeLock();updateSheetUI();
    toast('Tron\u00e7on enregistr\u00e9','g');save();
  }
}
function togglePause(){
  if(!S.recording)return;
  S.paused=!S.paused;
  if(S.paused){S.recElapsed+=Date.now()-S.recStart;clearInterval(S.recTimer);S.recTimer=null;}
  else{S.recStart=Date.now();S.recTimer=setInterval(updateRecTimer,1000);}
  adaptGPS();
}
function finishTrack(){if(S.recording)toggleRec();}
function updateRecTimer(){
  const el=document.getElementById('s-tim');if(!el)return;
  const ms=S.recElapsed+(S.paused?0:Date.now()-S.recStart);
  const s=Math.floor(ms/1000),m=Math.floor(s/60);
  el.textContent=String(m).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function updateTrkStats(){
  if(!S.recording||S.curTrack===null)return;
  const t=S.tracks[S.curTrack];
  const d=t.pts.length>=2?Math.round(t.pts.reduce((s,p,i)=>i?s+hav(t.pts[i-1],p):0,0)):0;
  const ep=document.getElementById('s-pts'),ed=document.getElementById('s-dst');
  if(ep)ep.textContent=t.pts.length;
  if(ed)ed.textContent=d;
}
function updateSheetUI(){
  const btn=document.getElementById('btn-rec'),fin=document.getElementById('btn-finish');
  const nm=document.getElementById('trk-name');
  if(S.recording){
    if(nm)nm.value=S.curTrack!==null?S.tracks[S.curTrack].name:'Tron\u00e7on';
    if(btn){btn.innerHTML='<span>\u23f9</span><span> Stop</span>';btn.style.background='var(--red,#FF3B30)';btn.style.color='#fff';}
    if(fin)fin.style.display='block';
  }else{
    if(btn){btn.innerHTML='<span>\u25cf</span><span> Enregistrer un tron\u00e7on</span>';btn.style.background='';btn.style.color='';}
    if(fin)fin.style.display='none';
  }
}

// ══ UTILS (definis ici, PAS dans sync.js) ══
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function hav(a,b){const R=6371000,dL=(b.lat-a.lat)*Math.PI/180,dO=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(dL/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dO/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

// ══ WAKE LOCK (defini ici, PAS dans sync.js) ══
let WAKE_LOCK=null;
async function requestWakeLock(){
  if(!('wakeLock' in navigator))return;
  try{WAKE_LOCK=await navigator.wakeLock.request('screen');WAKE_LOCK.addEventListener('release',()=>{WAKE_LOCK=null;});}catch(e){}
}
function releaseWakeLock(){if(WAKE_LOCK){WAKE_LOCK.release();WAKE_LOCK=null;}}

// ══ ERREURS GLOBALES ══
// Bruit a ignorer : ces "erreurs" ne signalent aucun probleme reel et
// polluaient l'interface (toast rouge au partage iOS notamment).
//  - "Script error." : erreur opaque d'un script cross-origin (CDN Leaflet).
//  - ResizeObserver loop... : avertissement benin (on observe #sheet).
//  - AbortError / NotAllowedError : partage iOS ferme ou permission refusee.
function isNoiseError(msg, filename, lineno){
  if(!msg) return true;
  const m = String(msg);
  if(m === 'Script error.' || m === 'Script error') return true;
  if(m.indexOf('ResizeObserver loop') === 0) return true;
  if(!filename && !lineno) return true;
  return false;
}
window.addEventListener('error',e=>{
  if(isNoiseError(e.message, e.filename, e.lineno)){
    console.warn('[TickS] Erreur opaque ignoree :', e.message||'(vide)');
    return;
  }
  const loc=e.filename?e.filename.split('/').pop()+':'+e.lineno:'';
  console.error('[TickS] Erreur',loc,e.message);
  if(typeof toast==='function')toast('\u274c '+String(e.message).slice(0,55)+(loc?' ('+loc+')':''),'r');
});
window.addEventListener('unhandledrejection',e=>{
  const name=(e.reason&&e.reason.name)||'';
  if(name==='AbortError'||name==='NotAllowedError'){
    console.warn('[TickS] Action annulee par l\'utilisateur :',name);
    return;
  }
  const msg=(e.reason&&e.reason.message)||String(e.reason||'');
  if(isNoiseError(msg,null,null)){
    console.warn('[TickS] Rejet opaque ignore');
    return;
  }
  console.error('[TickS] Async:',msg);
  if(typeof toast==='function')toast('\u26a0 '+msg.slice(0,60),'r');
});
document.addEventListener('DOMContentLoaded',()=>{
  const el=document.getElementById('app-version');
  if(el)el.textContent='v'+APP_VERSION;
});

// ══ BURGER + FILTRE ══
function openBurger(){document.getElementById('burger-menu').classList.add('open');}
function closeBurger(){document.getElementById('burger-menu').classList.remove('open');}
function toggleFilterPopover(){
  const p=document.getElementById('filter-popover'),b=document.getElementById('btn-filter-toggle');
  const open=p.classList.toggle('open');b.classList.toggle('active',open);
}
function closeFilterPopover(){
  const p=document.getElementById('filter-popover'),b=document.getElementById('btn-filter-toggle');
  if(p)p.classList.remove('open');
  if(b)b.classList.remove('active');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#filter-popover')&&!e.target.closest('#btn-filter-toggle'))closeFilterPopover();
},true);

// ══ BOOT MAP (appele depuis sync.js) ══
function _bootMap(){
  paintTypeUI();
  addZoomButtons();
  initMap();bindMapPicking();resizeMap();
  [200,600,1200].forEach(ms=>setTimeout(()=>{if(MAP)MAP.invalidateSize();resizeMap();},ms));
  const sheet=document.getElementById('sheet');
  if(sheet)new ResizeObserver(()=>{resizeMap();if(MAP)MAP.invalidateSize();}).observe(sheet);
}