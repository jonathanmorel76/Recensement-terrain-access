// ========================================
// TickS Terrain — app.js v1.5.0
// GPS, Carte, Capture, UI
// NOTE : le BOOT (load/startGPS/_bootMap) est en fin de sync.js
// car sync.js charge en dernier. Ne PAS le remettre ici.
// ========================================
const APP_VERSION = '1.5.0';
console.log('[TickS Terrain] app.js v1.5.0 charge');

const S = {
  pos:null, acc:null, gpsHighMode:false,
  waypoints:[], tracks:[],
  recording:false, paused:false,
  curTrack:null,
  recStart:null, recElapsed:0, recTimer:null,
  pendingType:null, pendingPos:null
};
const AVG = { active:false, type:null, samples:[], target:8, maxAcc:20 };
let EDIT_ID = null;
let MAP = null, MAP_OK = false;
let MAP_LAYER_OSM = null, MAP_LAYER_AERIAL = null, MAP_AERIAL = false;
const TILE_OSM    = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_AERIAL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
let MAP_LAYERS = [], MAP_REC_LINE = null, MAP_POS = null;
let MAP_FILTER = 'all';
const COLORS = { entree:'#a855f7', equip_comp:'#06b6d4', equip_acces:'#f97316', noeud:'#60a5fa', autre:'#f59e0b' };
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
      const now=Date.now(),throttle=(S.recording&&!S.paused)?2000:5000;
      if(MAP_OK&&S.pos&&(now-GPS_LAST_MAP)>throttle){
        GPS_LAST_MAP=now;
        if(MAP_POS){try{MAP.removeLayer(MAP_POS);}catch(e){}}
        MAP_POS=L.marker([S.pos.lat,S.pos.lon],{icon:mkPosIcon(),zIndexOffset:1000}).addTo(MAP);
      }
      if(S.recording&&!S.paused&&S.acc<=15){
        const t=S.tracks[S.curTrack];
        t.pts.push({lat:S.pos.lat,lon:S.pos.lon,ts:Date.now(),acc:S.acc});
        updateTrkStats();updateMapLive();
      }
      if(AVG.active&&S.acc<=AVG.maxAcc){
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
    highAccuracy?{enableHighAccuracy:true,timeout:15000,maximumAge:500}
      :(isIOS16Plus()||isAndroidModern())?{enableHighAccuracy:true,timeout:20000,maximumAge:3000}
      :{enableHighAccuracy:false,timeout:30000,maximumAge:8000}
  );
}
function adaptGPS(){
  const needHigh=(S.recording&&!S.paused)||AVG.active,isHigh=S.gpsHighMode||false;
  if(needHigh&&!isHigh){S.gpsHighMode=true;launchWatch(true);}
  if(!needHigh&&isHigh){S.gpsHighMode=false;launchWatch(false);}
}
function gotoGPS(){if(!S.pos){toast('Position GPS inconnue','a');return;}MAP.setView([S.pos.lat,S.pos.lon],17);}
function updateGpsBar(acc){
  const bar=document.getElementById('gps-bar-txt');
  const btn=document.getElementById('btn-geolocate');
  if(!bar)return;
  if(acc<=5){bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--green,#34C759)';}
  else if(acc<=15){bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--orange,#FF9F0A)';}
  else{bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--red,#FF3B30)';}
  if(btn)btn.classList.toggle('tracking',acc<=15);
}

// ══ CARTE ══
function initMap(){
  if(!MAP_OK){
    MAP=L.map('map',{zoomControl:false,attributionControl:true});
    MAP_LAYER_OSM=L.tileLayer(TILE_OSM,{attribution:'\u00a9 <a href="https://openstreetmap.org">OSM</a>',maxZoom:19}).addTo(MAP);
    MAP_LAYER_AERIAL=L.tileLayer(TILE_AERIAL,{attribution:'\u00a9 IGN G\u00e9oplateforme',maxZoom:19});
    MAP.setView([49.18,0.35],9);
    MAP_OK=true;
    if(S.pos)MAP.setView([S.pos.lat,S.pos.lon],16);
  }
  refreshMap();
  setTimeout(()=>{if(MAP)MAP.invalidateSize();},150);
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
    const m=L.marker([w.lat,w.lon],{icon:wptIcon(w.type)}).addTo(MAP);
    m.bindPopup('<b>'+esc(w.name)+'</b><br><small>'+(w.subtype||w.type)+'</small>');
    MAP_LAYERS.push(m);
  });
  S.tracks.forEach(t=>{
    if(!t.pts||t.pts.length<2)return;
    MAP_LAYERS.push(L.polyline(t.pts.map(p=>[p.lat,p.lon]),{color:'#4ade80',weight:3,opacity:.85}).addTo(MAP));
  });
}
function wptIcon(type){
  const c=COLORS[type]||'#888';
  return L.divIcon({html:'<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28"><circle cx="11" cy="11" r="10" fill="'+c+'" stroke="#fff" stroke-width="2"/><line x1="11" y1="21" x2="11" y2="28" stroke="'+c+'" stroke-width="2"/></svg>',iconSize:[22,28],iconAnchor:[11,28],popupAnchor:[0,-28],className:''});
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
  if(!S.pos){toast('GPS non disponible \u2014 attendez','a');return;}
  S.pendingType=type;S.pendingPos={lat:S.pos.lat,lon:S.pos.lon,acc:S.acc};
  AVG.active=true;AVG.type=type;AVG.samples=[];AVG.target=8;AVG.maxAcc=20;
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
  AVG.active=false;AVG.samples=[];
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS();releaseWakeLock();
}
function commitAvg(){
  const pts=AVG.samples;
  const lat=pts.reduce((s,p)=>s+p.lat,0)/pts.length;
  const lon=pts.reduce((s,p)=>s+p.lon,0)/pts.length;
  const acc=Math.round(pts.reduce((s,p)=>s+p.acc,0)/pts.length);
  AVG.active=false;AVG.samples=[];
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS();releaseWakeLock();
  S.pendingPos={lat,lon,acc};
  openWptModal(AVG.type||S.pendingType,lat,lon,acc);
}
function openWptModal(type,lat,lon,acc){
  document.getElementById('wm-title').textContent='Point \u2014 '+typeLabel(type);
  document.getElementById('wm-coords').textContent=lat.toFixed(5)+', '+lon.toFixed(5)+(acc?' \u00b7 \u00b1'+acc+'m':'');
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
  S.waypoints.push({id:crypto.randomUUID?crypto.randomUUID():'wp-'+Date.now(),type,subtype,name,desc,lat:pos.lat,lon:pos.lon,acc:pos.acc||0,ts:Date.now()});
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
      return '<div class="wpt-item"><div class="wdot" style="background:'+c+'20;color:'+c+'"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg></div><div class="winfo" onclick="editWpt(\''+obj.id+'\')" style="cursor:pointer"><div class="wname">'+esc(obj.name)+'</div><div class="wmeta">'+obj.lat.toFixed(5)+', '+obj.lon.toFixed(5)+' \u00b7 '+(obj.subtype||obj.type)+'</div>'+(obj.desc?'<div class="wdesc">'+esc(obj.desc)+'</div>':'')+'</div><button class="wbtn" onclick="delWpt(\''+obj.id+'\')">&times;</button></div>';
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
  document.getElementById('em-coords').textContent=w.lat.toFixed(6)+', '+w.lon.toFixed(6)+(w.acc?' \u00b7 \u00b1'+w.acc+'m':'');
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
window.addEventListener('error',e=>{
  const loc=e.filename?e.filename.split('/').pop()+':'+e.lineno:'';
  console.error('[TickS] Erreur',loc,e.message);
  if(typeof toast==='function')toast('\u274c '+(e.message||'Erreur').slice(0,55)+(loc?' ('+loc+')':''),'r');
});
window.addEventListener('unhandledrejection',e=>{
  const msg=(e.reason&&e.reason.message)||String(e.reason)||'Promesse rejet\u00e9e';
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
  initMap();resizeMap();
  [200,600,1200].forEach(ms=>setTimeout(()=>{if(MAP)MAP.invalidateSize();resizeMap();},ms));
  const sheet=document.getElementById('sheet');
  if(sheet)new ResizeObserver(()=>{resizeMap();if(MAP)MAP.invalidateSize();}).observe(sheet);
}