// ========================================
// TickS Terrain — app.js
// GPS, Carte, Capture, UI, Navigation
// ========================================
const APP_VERSION = '1.4.0';
console.log('[TickS Terrain] v1.4.0 — prêt');

// ══════════════════════════════
// ÉTAT
// ══════════════════════════════
const S = {
  pos:null, acc:null,
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
const LABELS = { entree:'Entr\u00e9e b\u00e2timent', equip_comp:'Info voyageur', equip_acces:'\u00c9quip. d\'acc\u00e8s', noeud:'N\u0153ud cheminement', autre:'Autre' };
const SUBS = {
  entree:     ['PRINCIPALE','SECONDAIRE','SERVICE','URGENCE','QUAI','AUTRE'],
  equip_comp: ['BORNE_INFO','PLAN_TACTILE','ANNONCE_SONORE','DISTRIBUTEUR_TITRES','SIGNALETIQUE_VISUELLE','AFFICHEUR_QUAI','AUTRE'],
  equip_acces:['ESCALIER','ASCENSEUR','RAMPE_ACCES','TRAVERSEE_PIETONS','ABAISSEMENT_TROTTOIR','RESSAUT','AUTRE'],
  noeud:      ['INTERSECTION','CARREFOUR','ENTREE_ERP','ARRET_TC','AUTRE'],
  autre:      ['A_CLASSIFIER','OBSTACLE','REMARQUE','PHOTO_REF']
};

function goTabStub(id){
  const views = ['terrain','points','export'];
  views.forEach(v => {
    const el = document.getElementById('pane-'+v);
    if(el) el.style.display = v===id ? (v==='terrain'?'block':'flex') : 'none';
  });
}

let GPS_WATCH_ID = null;
let GPS_LAST_MAP = 0;

function startGPS(){
  if(!navigator.geolocation){toast('GPS non disponible','r');return;}
  const bar=document.getElementById('gps-bar-txt');
  if(bar) bar.textContent='Recherche\u2026';
  const useHighFromStart = isIOS16Plus() || isAndroidModern();
  launchWatch(useHighFromStart);
}

function isIOS16Plus(){
  const ua=navigator.userAgent;
  if(!/iPhone|iPad|iPod/.test(ua)) return false;
  const m=ua.match(/OS (\d+)_/);
  return m && parseInt(m[1])>=16;
}
function isAndroidModern(){
  const ua=navigator.userAgent;
  if(!/Android/.test(ua)) return false;
  const m=ua.match(/Android (\d+)/);
  return m && parseInt(m[1])>=10;
}

function launchWatch(highAccuracy){
  if(GPS_WATCH_ID!==null){
    navigator.geolocation.clearWatch(GPS_WATCH_ID);
    GPS_WATCH_ID=null;
  }
  GPS_WATCH_ID = navigator.geolocation.watchPosition(
    pos=>{
      S.pos={lat:pos.coords.latitude,lon:pos.coords.longitude};
      S.acc=Math.round(pos.coords.accuracy);
      updateGpsBar(S.acc);
      const now=Date.now();
      const mapThrottle=(S.recording&&!S.paused)?2000:5000;
      if(MAP_OK&&S.pos&&(now-GPS_LAST_MAP)>mapThrottle){
        GPS_LAST_MAP=now;
        if(MAP_POS){try{MAP.removeLayer(MAP_POS);}catch(e){}}
        MAP_POS=L.marker([S.pos.lat,S.pos.lon],{icon:mkPosIcon(),zIndexOffset:1000}).addTo(MAP);
      }
      if(S.recording&&!S.paused&&S.acc<=15){
        const t=S.tracks[S.curTrack];
        t.pts.push({lat:S.pos.lat,lon:S.pos.lon,ts:Date.now(),acc:S.acc});
        updateTrkStats();
        updateMapLive();
      }
      if(AVG.active&&S.acc<=AVG.maxAcc){
        AVG.samples.push({lat:S.pos.lat,lon:S.pos.lon,acc:S.acc});
        updateAvgUI();
        if(AVG.samples.length>=AVG.target) commitAvg();
      }
    },
    err=>{
      const bar=document.getElementById('gps-bar-txt');
      if(bar){bar.textContent='Err';bar.style.color='var(--red,#ef4444)';}
      const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
      if(err.code===1) toast(ios?'Autorisez la localisation dans R\u00e9glages \u203a Safari':'Permission GPS refus\u00e9e','r');
      else if(err.code===3) toast('GPS : timeout \u2014 allez \u00e0 l\'air libre','a');
    },
    highAccuracy
      ? {enableHighAccuracy:true,  timeout:15000, maximumAge:500}
      : (isIOS16Plus()||isAndroidModern())
        ? {enableHighAccuracy:true,  timeout:20000, maximumAge:3000}
        : {enableHighAccuracy:false, timeout:30000, maximumAge:8000}
  );
}

function adaptGPS(){
  const needHigh=S.recording&&!S.paused||AVG.active;
  const isHigh=S.gpsHighMode||false;
  if(needHigh&&!isHigh){S.gpsHighMode=true;launchWatch(true);}
  if(!needHigh&&isHigh){S.gpsHighMode=false;launchWatch(false);}
}

function gotoGPS(){
  if(!S.pos){toast('Position GPS inconnue','a');return;}
  MAP.setView([S.pos.lat,S.pos.lon],17);
}

function updateGpsBar(acc){
  const bar=document.getElementById('gps-bar-txt');
  const btn=document.getElementById('btn-geolocate');
  if(!bar) return;
  if(acc<=5){bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--green,#34C759)';}
  else if(acc<=15){bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--orange,#FF9F0A)';}
  else{bar.textContent='\u00b1'+acc+'m';bar.style.color='var(--red,#FF3B30)';}
  if(btn) btn.classList.toggle('tracking',acc<=15);
}

function initMap(){
  if(!MAP_OK){
    MAP=L.map('map',{zoomControl:false,attributionControl:true});
    MAP_LAYER_OSM=L.tileLayer(TILE_OSM,{attribution:'\u00a9 <a href="https://openstreetmap.org">OSM</a>',maxZoom:19}).addTo(MAP);
    MAP_LAYER_AERIAL=L.tileLayer(TILE_AERIAL,{attribution:'\u00a9 <a href="https://www.ign.fr">IGN</a> \u2014 G\u00e9oplateforme',maxZoom:19});
    MAP.setView([49.18,0.35],9);
    MAP_OK=true;
    if(S.pos) MAP.setView([S.pos.lat,S.pos.lon],16);
  }
  refreshMap();
}

function resizeMap(){
  const el=document.getElementById('map');
  const sheet=document.getElementById('sheet');
  if(!el||!sheet) return;
  const sh=sheet.offsetHeight||56;
  el.style.height=(window.innerHeight-sh)+'px';
}

function refreshMap(){
  if(!MAP_OK) return;
  MAP_LAYERS.forEach(l=>{try{MAP.removeLayer(l);}catch(e){}});
  MAP_LAYERS=[];
  const showTypes=MAP_FILTER==='all'?Object.keys(COLORS):[MAP_FILTER];
  S.waypoints.filter(w=>showTypes.includes(w.type)).forEach(w=>{
    const icon=wptIcon(w.type);
    const m=L.marker([w.lat,w.lon],{icon}).addTo(MAP);
    m.bindPopup(`<b>${esc(w.name)}</b><br><small>${w.subtype||w.type}</small>`);
    MAP_LAYERS.push(m);
  });
  S.tracks.forEach((t,i)=>{
    if(!t.pts||t.pts.length<2) return;
    const pts=t.pts.map(p=>[p.lat,p.lon]);
    const l=L.polyline(pts,{color:'#4ade80',weight:3,opacity:.85}).addTo(MAP);
    MAP_LAYERS.push(l);
  });
}

function wptIcon(type){
  const c=COLORS[type]||'#888';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28"><circle cx="11" cy="11" r="10" fill="${c}" stroke="#fff" stroke-width="2"/><line x1="11" y1="21" x2="11" y2="28" stroke="${c}" stroke-width="2"/></svg>`;
  return L.divIcon({html:svg,iconSize:[22,28],iconAnchor:[11,28],popupAnchor:[0,-28],className:''});
}

function mkPosIcon(){
  return L.divIcon({html:'<div style="width:14px;height:14px;border-radius:50%;background:#007AFF;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,255,.4)"></div>',iconSize:[14,14],iconAnchor:[7,7],className:''});
}

function updateMapLive(){
  if(!MAP_OK||!S.recording) return;
  const t=S.tracks[S.curTrack];
  if(!t||t.pts.length<2) return;
  if(MAP_REC_LINE) try{MAP.removeLayer(MAP_REC_LINE);}catch(e){}
  MAP_REC_LINE=L.polyline(t.pts.map(p=>[p.lat,p.lon]),{color:'#4ade80',weight:3}).addTo(MAP);
}

function toggleLayer(){
  MAP_AERIAL=!MAP_AERIAL;
  if(MAP_AERIAL){
    MAP.removeLayer(MAP_LAYER_OSM);
    MAP_LAYER_AERIAL.addTo(MAP);
  } else {
    MAP.removeLayer(MAP_LAYER_AERIAL);
    MAP_LAYER_OSM.addTo(MAP);
  }
  const btn=document.getElementById('btn-layer');
  if(btn) btn.style.color=MAP_AERIAL?'var(--ticks,#8A3090)':'';
}

function applyFilter(f, btn){
  MAP_FILTER=f;
  document.querySelectorAll('#filter-popover button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  refreshMap();
  if(typeof closeFilterPopover==='function') closeFilterPopover();
}

function startCapture(type){
  if(!S.pos){toast('Position GPS non disponible \u2014 attendez le signal','a');return;}
  S.pendingType=type;
  S.pendingPos={lat:S.pos.lat,lon:S.pos.lon,acc:S.acc};
  AVG.active=true; AVG.type=type; AVG.samples=[]; AVG.target=8; AVG.maxAcc=20;
  adaptGPS();
  requestWakeLock();
  const t=document.getElementById('avg-title');
  if(t) t.textContent='Lev\u00e9 '+typeLabel(type);
  document.getElementById('avg-prog-fill').style.width='0%';
  document.getElementById('avg-n').textContent='0/8';
  document.getElementById('avg-acc').textContent='\u00b1\u2014 m';
  const fb=document.getElementById('avg-force');
  if(fb){fb.disabled=true;fb.style.opacity='.4';}
  document.getElementById('avg-modal').classList.add('open');
}

function typeLabel(t){
  return {entree:'Entr\u00e9e',equip_comp:'Info voy.',equip_acces:'\u00c9quip.acc\u00e8s',noeud:'N\u0153ud',autre:'Autre'}[t]||t;
}

function updateAvgUI(){
  const n=AVG.samples.length, tgt=AVG.target;
  const pct=Math.min(100,Math.round(n/tgt*100));
  document.getElementById('avg-prog-fill').style.width=pct+'%';
  document.getElementById('avg-n').textContent=n+'/'+tgt;
  const accAvg=AVG.samples.length?Math.round(AVG.samples.reduce((s,p)=>s+p.acc,0)/AVG.samples.length):0;
  document.getElementById('avg-acc').textContent='\u00b1'+accAvg+'m';
  const fb=document.getElementById('avg-force');
  if(fb&&n>=3&&fb.disabled){fb.disabled=false;fb.style.opacity='1';}
}

function forceAvg(){
  if(AVG.samples.length>=3) commitAvg();
}

function cancelAvg(){
  AVG.active=false; AVG.samples=[];
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS(); releaseWakeLock();
}

function commitAvg(){
  const pts=AVG.samples;
  const lat=pts.reduce((s,p)=>s+p.lat,0)/pts.length;
  const lon=pts.reduce((s,p)=>s+p.lon,0)/pts.length;
  const acc=Math.round(pts.reduce((s,p)=>s+p.acc,0)/pts.length);
  AVG.active=false; AVG.samples=[];
  document.getElementById('avg-modal').classList.remove('open');
  adaptGPS(); releaseWakeLock();
  S.pendingPos={lat,lon,acc};
  openWptModal(AVG.type||S.pendingType, lat, lon, acc);
}

function openWptModal(type, lat, lon, acc){
  document.getElementById('wm-title').textContent='Point \u2014 '+typeLabel(type);
  document.getElementById('wm-coords').textContent=lat.toFixed(5)+', '+lon.toFixed(5)+(acc?' \u00b7 \u00b1'+acc+'m':'');
  document.getElementById('wm-name').value='';
  const sub=document.getElementById('wm-sub');
  sub.innerHTML=(SUBS[type]||['AUTRE']).map(v=>`<option>${v}</option>`).join('');
  document.getElementById('wm-desc').value='';
  document.getElementById('wpt-modal').classList.add('open');
}

function closeWptModal(){
  document.getElementById('wpt-modal').classList.remove('open');
}

function saveWpt(){
  const pos=S.pendingPos||S.pos;
  if(!pos){toast('Pas de position','r');return;}
  const type=S.pendingType||'autre';
  const name=document.getElementById('wm-name').value.trim()||typeLabel(type)+' '+(S.waypoints.length+1);
  const subtype=document.getElementById('wm-sub').value;
  const desc=document.getElementById('wm-desc').value.trim();
  S.waypoints.push({id:crypto.randomUUID?crypto.randomUUID():'wp-'+Date.now(),type,subtype,name,desc,lat:pos.lat,lon:pos.lon,acc:pos.acc||0,ts:Date.now()});
  closeWptModal();
  S.pendingType=null; S.pendingPos=null;
  refreshMap(); save();
  toast('\u2713 Point enregistr\u00e9','g');
}

function renderPts(){
  const el=document.getElementById('pts-list');
  const all=[
    ...S.waypoints.map(w=>({...w,_k:'w'})),
    ...S.tracks.map((t,i)=>({...t,_k:'t',_i:i}))
  ].sort((a,b)=>(a.ts||a.startTs)-(b.ts||b.startTs));
  if(!all.length){el.innerHTML='<div class="empty">Aucun point enregistr\u00e9.<br>Allez dans Terrain pour commencer.</div>';return;}
  el.innerHTML=all.map(obj=>{
    if(obj._k==='w'){
      const c=COLORS[obj.type]||'#888';
      const icons={
        entree:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        equip_comp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        equip_acces:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="10" x2="12" y2="16"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>',
        noeud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/></svg>',
        autre:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>'
      }[obj.type]||'';
      return `<div class="wpt-item">
        <div class="wdot" style="background:${c}20;color:${c}">${icons}</div>
        <div class="winfo" onclick="editWpt('${obj.id}')" style="cursor:pointer">
          <div class="wname">${esc(obj.name)}</div>
          <div class="wmeta">${obj.lat.toFixed(5)}, ${obj.lon.toFixed(5)} \u00b7 ${obj.subtype||obj.type}</div>
          ${obj.desc?`<div class="wdesc">${esc(obj.desc)}</div>`:''}
        </div>
        <button class="wbtn" onclick="editWpt('${obj.id}')" title="Modifier">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="wbtn" onclick="delWpt('${obj.id}')">\u2715</button>
      </div>`;
    } else {
      const d=obj.pts&&obj.pts.length>=2?Math.round(obj.pts.reduce((s,p,i)=>i?s+hav(obj.pts[i-1],p):0,0)):0;
      return `<div class="wpt-item" style="border-color:#4ade8055">
        <div class="wdot" style="background:#4ade8020;color:#4ade80"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17 Q8 7 12 12 Q16 17 21 7"/></svg></div>
        <div class="winfo" onclick="editTrk(${obj._i})" style="cursor:pointer">
          <div class="wname">${esc(obj.name)}</div>
          <div class="wmeta">${obj.pts?obj.pts.length:0} pts \u00b7 ${d} m</div>
        </div>
        <button class="wbtn" onclick="editTrk(${obj._i})" title="Renommer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="wbtn" onclick="delTrk(${obj._i})">\u2715</button>
      </div>`;
    }
  }).join('');
}
function delWpt(id){if(!confirm('Supprimer ?'))return;S.waypoints=S.waypoints.filter(w=>w.id!==id);renderPts();save();}
function delTrk(i){if(!confirm('Supprimer ?'))return;S.tracks.splice(i,1);renderPts();save();}
function editTrk(i){
  const n=prompt('Nom du tron\u00e7on :',S.tracks[i].name);
  if(n===null)return; S.tracks[i].name=n.trim()||S.tracks[i].name;
  renderPts(); save(); toast('Renomm\u00e9','g');
}
function editWpt(id){
  const w=S.waypoints.find(x=>x.id===id); if(!w)return;
  EDIT_ID=id;
  document.getElementById('em-coords').textContent=w.lat.toFixed(6)+', '+w.lon.toFixed(6)+(w.acc?' \u00b7 \u00b1'+w.acc+'m':'');
  document.querySelectorAll('#em-types .topt').forEach(el=>el.classList.toggle('sel',el.dataset.t===w.type));
  fillEditSubs(w.type,w.subtype);
  document.getElementById('em-name').value=w.name||'';
  document.getElementById('em-desc').value=w.desc||'';
  document.getElementById('edit-modal').classList.add('open');
}
function pickType(t,el){
  document.querySelectorAll('#em-types .topt').forEach(e=>e.classList.remove('sel'));
  el.classList.add('sel'); fillEditSubs(t,null);
}
function fillEditSubs(type,cur){
  document.getElementById('em-sub').innerHTML=(SUBS[type]||['AUTRE']).map(v=>`<option ${v===cur?'selected':''}>${v}</option>`).join('');
}
function closeEditModal(){document.getElementById('edit-modal').classList.remove('open');EDIT_ID=null;}
function saveEdit(){
  if(!EDIT_ID)return;
  const i=S.waypoints.findIndex(x=>x.id===EDIT_ID); if(i<0)return;
  const t=document.querySelector('#em-types .topt.sel')?.dataset.t||S.waypoints[i].type;
  S.waypoints[i]={...S.waypoints[i],type:t,subtype:document.getElementById('em-sub').value,
    name:document.getElementById('em-name').value.trim()||S.waypoints[i].name,
    desc:document.getElementById('em-desc').value.trim()};
  closeEditModal(); renderPts(); refreshMap(); save(); toast('Modifi\u00e9','g');
}

function toggleRec(){
  if(!S.recording){
    S.recording=true; S.paused=false;
    S.curTrack=S.tracks.length;
    S.tracks.push({name:'Tron\u00e7on '+(S.tracks.length+1),pts:[],startTs:Date.now()});
    S.recStart=Date.now(); S.recElapsed=0;
    S.recTimer=setInterval(updateRecTimer,1000);
    adaptGPS(); requestWakeLock();
    updateSheetUI();
    toast('Enregistrement d\u00e9marr\u00e9','g');
  } else {
    S.recording=false; S.paused=false;
    clearInterval(S.recTimer); S.recTimer=null;
    adaptGPS(); releaseWakeLock();
    updateSheetUI();
    toast('Tron\u00e7on enregistr\u00e9','g');
    save();
  }
}
function togglePause(){
  if(!S.recording)return;
  S.paused=!S.paused;
  if(S.paused){S.recElapsed+=Date.now()-S.recStart;clearInterval(S.recTimer);S.recTimer=null;}
  else{S.recStart=Date.now();S.recTimer=setInterval(updateRecTimer,1000);}
  adaptGPS();
  const btn=document.getElementById('btn-pause');
  if(btn) btn.textContent=S.paused?'\u25b6 Reprendre':'\u23f8 Pause';
}
function finishTrack(){
  if(S.recording) toggleRec();
}
function updateRecTimer(){
  const el=document.getElementById('rec-time')||document.getElementById('s-tim');
  if(!el)return;
  const ms=(S.recElapsed+(S.paused?0:Date.now()-S.recStart));
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);
  el.textContent=(h?h+'h':'')+String(m%60).padStart(2,'0')+(h?'m':':')+String(s%60).padStart(2,'0')+(h?'s':'');
}
function updateTrkStats(){
  const el=document.getElementById('trk-pts')||document.getElementById('s-pts');
  const dst=document.getElementById('s-dst');
  if(!S.recording||S.curTrack===null)return;
  const t=S.tracks[S.curTrack];
  const d=t.pts.length>=2?Math.round(t.pts.reduce((s,p,i)=>i?s+hav(t.pts[i-1],p):0,0)):0;
  if(el) el.textContent=t.pts.length;
  if(dst) dst.textContent=d;
}
function updateSheetUI(){
  const nameEl=document.getElementById('trk-name');
  const btn=document.getElementById('btn-rec');
  const finBtn=document.getElementById('btn-finish');
  if(S.recording){
    if(nameEl) nameEl.value=S.curTrack!==null?S.tracks[S.curTrack].name:'Tron\u00e7on';
    if(btn){btn.innerHTML='<span>\u23f9</span><span> Stop enregistrement</span>';btn.style.background='var(--red,#FF3B30)';btn.style.color='#fff';}
    if(finBtn) finBtn.style.display='block';
  } else {
    if(btn){btn.innerHTML='<span>\u25cf</span><span> Enregistrer un tron\u00e7on</span>';btn.style.background='';btn.style.color='';}
    if(finBtn) finBtn.style.display='none';
  }
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function hav(a,b){const R=6371000,dL=(b.lat-a.lat)*Math.PI/180,dO=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(dL/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dO/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

// ══════════════════════════════
// GESTIONNAIRE D'ERREUR GLOBAL
// Crashs visibles sur le terrain + log console
// ══════════════════════════════
window.addEventListener('error', e => {
  const loc = e.filename ? e.filename.split('/').pop() + ':' + e.lineno : '';
  console.error('[TickS] Erreur', loc, e.message, e.error);
  if(typeof toast === 'function')
    toast('\u274c ' + (e.message||'Erreur').slice(0,55) + (loc?' ('+loc+')':''), 'r');
});
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason?.message || String(e.reason) || 'Promesse rejet\u00e9e';
  console.error('[TickS] Async non g\u00e9r\u00e9:', msg, e.reason);
  if(typeof toast === 'function')
    toast('\u26a0 ' + msg.slice(0,60), 'r');
});

// Afficher la version dans le burger au chargement
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if(el) el.textContent = 'v' + APP_VERSION;
});