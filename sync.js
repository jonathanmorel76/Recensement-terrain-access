// ========================================
// TickS Terrain — sync.js
// Rendu listes, Sync Supabase, Exports
// ========================================
function renderExp(){
  const cfg = getSyncCfg();
  const dot  = document.getElementById('sync-dot');
  const stxt = document.getElementById('sync-status-txt');
  const cfgRow = document.getElementById('sync-cfg-row');
  const lastEl = document.getElementById('sync-last');
  const lastTs = localStorage.getItem('ldm_last_sync_time');

  if(dot && stxt){
    if(cfg.sbUrl){
      dot.style.background = 'var(--green,#34C759)';
      stxt.textContent = cfg.sbUrl.replace('https://','').slice(0,32)+'…';
    } else {
      dot.style.background = 'var(--txt3)';
      stxt.textContent = 'Non configuré — tapez ⚙';
    }
  }
  if(lastEl && lastTs){ lastEl.style.display='block'; document.getElementById('sync-last-time').textContent=lastTs; }
  if(cfgRow) cfgRow.style.display = cfg.sbUrl ? 'none' : 'block';
  updateQueueBadge();
  const counts={};
  S.waypoints.forEach(w=>counts[w.type]=(counts[w.type]||0)+1);
  document.getElementById('exp-stats').innerHTML=
    Object.entries(counts).map(([t,n])=>`<div class="stat-chip"><span class="n" style="color:${COLORS[t]||'#888'}">${n}</span><span style="font-size:12px;color:var(--txt2)">${LABELS[t]||t}</span></div>`).join('')+
    (S.tracks.length?`<div class="stat-chip"><span class="n" style="color:#4ade80">${S.tracks.length}</span><span style="font-size:12px;color:var(--txt2)">tronçons</span></div>`:'');
  const cfgBtn = document.getElementById('sync-cfg-row');
  if(cfgBtn) cfgBtn.style.display = getSyncCfg().sbUrl ? 'none' : 'flex';
}

function getSyncCfg(){
  return {
    sbUrl:      localStorage.getItem('ldm_sb_url')  || '',
    sbKey:      localStorage.getItem('ldm_sb_key')  || '',
    nomSession: localStorage.getItem('ldm_nom_session') || ''
  };
}

function openSyncConfig(){
  document.getElementById('sync-modal').classList.add('open');
  const cfg = getSyncCfg();
  document.getElementById('sc-sb-url').value  = cfg.sbUrl;
  document.getElementById('sc-sb-key').value  = cfg.sbKey;
  document.getElementById('sc-nom').value      = cfg.nomSession;
}
function closeSyncConfig(){
  document.getElementById('sync-modal').classList.remove('open');
}
function saveSyncConfig(){
  localStorage.setItem('ldm_sb_url',        document.getElementById('sc-sb-url').value.trim().replace(/\/$/,''));
  localStorage.setItem('ldm_sb_key',        document.getElementById('sc-sb-key').value.trim());
  localStorage.setItem('ldm_nom_session',   document.getElementById('sc-nom').value.trim());
  closeSyncConfig();
  toast('Configuration enregistrée','g');
  renderExp();
}

async function sbInsert(cfg, table, row){
  const r = await fetch(`${cfg.sbUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         cfg.sbKey,
      'Authorization': `Bearer ${cfg.sbKey}`,
      'Prefer':        'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });
  if(!r.ok){ const e = await r.text(); throw new Error(`${table}: ${r.status} ${e}`); }
}

// ══════════════════════════════════════════
// FILE D'ATTENTE OFFLINE — IndexedDB
// ══════════════════════════════════════════
const QUEUE_DB  = 'ticks-offline-queue';
const QUEUE_VER = 1;
function openQueueDB(){
  return new Promise((res,rej) => {
    const req = indexedDB.open(QUEUE_DB, QUEUE_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('queue'))
        db.createObjectStore('queue', {keyPath:'id', autoIncrement:true});
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function queuePush(payload){
  const db = await openQueueDB();
  return new Promise((res,rej) => {
    const tx  = db.transaction('queue','readwrite');
    const req = tx.objectStore('queue').add({...payload, queuedAt: Date.now()});
    req.onsuccess = () => res(req.result);
    req.onerror   = e  => rej(e.target.error);
  });
}
async function queueGetAll(){
  const db = await openQueueDB();
  return new Promise((res,rej) => {
    const tx  = db.transaction('queue','readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = e  => rej(e.target.error);
  });
}
async function queueDelete(id){
  const db = await openQueueDB();
  return new Promise((res,rej) => {
    const tx  = db.transaction('queue','readwrite');
    const req = tx.objectStore('queue').delete(id);
    req.onsuccess = () => res();
    req.onerror   = e  => rej(e.target.error);
  });
}
async function queueCount(){
  const db = await openQueueDB();
  return new Promise((res,rej) => {
    const tx  = db.transaction('queue','readonly');
    const req = tx.objectStore('queue').count();
    req.onsuccess = () => res(req.result);
    req.onerror   = ()  => res(0);
  });
}
async function flushQueue(){
  let pending;
  try { pending = await queueGetAll(); } catch(e){ return; }
  if(!pending.length) return;
  toast(`📦 Reconnexion — envoi de ${pending.length} session(s)…`,'a');
  let ok = 0, fail = 0;
  for(const entry of pending){
    try { await replaySync(entry); await queueDelete(entry.id); ok++; }
    catch(e){ fail++; console.warn('Queue flush error:', e); }
  }
  updateQueueBadge();
  if(ok > 0)  toast(`✓ ${ok} session(s) synchronisée(s) depuis la file offline`,'g');
  if(fail > 0) toast(`${fail} session(s) toujours en attente`,'r');
}
async function replaySync(entry){
  const cfg = getSyncCfg();
  if(!cfg.sbUrl || !cfg.sbKey) throw new Error('Non configuré');
  await sbInsert(cfg, 'session_terrain', {id:entry.sessionId, nom:entry.sessionNom, statut:'en_cours'});
  for(const row of (entry.rows || [])){ await sbInsert(cfg, row.table, row.data); }
}
async function updateQueueBadge(){
  let count = 0;
  try { count = await queueCount(); } catch(e){}
  const row = document.getElementById('queue-status-row');
  if(row) row.style.display = count > 0 ? 'flex' : 'none';
  const label = document.getElementById('queue-label');
  if(label && count > 0) label.textContent = `${count} session(s) en attente d'envoi`;
}
window.addEventListener('online',  () => { flushQueue(); });
window.addEventListener('offline', () => { toast('Hors ligne — sync en attente','a'); });
document.addEventListener('DOMContentLoaded', () => { updateQueueBadge(); });

async function syncToCloud(){
  if(!S.waypoints.length && !S.tracks.length){ toast('Rien à synchroniser','a'); return; }
  const cfg = getSyncCfg();
  if(!cfg.sbUrl || !cfg.sbKey){ openSyncConfig(); return; }
  const btn = document.getElementById('btn-sync');
  btn.textContent = '↑ Synchronisation…';
  btn.disabled = true;
  try {
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : 'ses-'+Date.now();
    await sbInsert(cfg, 'session_terrain', {id:sessionId, nom:cfg.nomSession||`Session ${new Date().toLocaleDateString('fr-FR')}`, statut:'en_cours'});
    let ok = 0, errs = 0;
    for(const w of S.waypoints){
      const geom = `SRID=4326;POINT(${w.lon} ${w.lat})`;
      const base = {id:w.id, session_id:sessionId, geom, nom:w.name, precision_gps:w.acc, nb_mesures_gps:w.samples||null, notes:w.desc||null};
      try {
        if(w.type==='entree')           await sbInsert(cfg,'entree_batiment',  {...base, type_entree:w.subtype||'PRINCIPALE'});
        else if(w.type==='equip_acces') await sbInsert(cfg,'equipement_acces', {...base, type_equip:w.subtype||'AUTRE'});
        else if(w.type==='equip_comp')  await sbInsert(cfg,'equipement_info',  {...base, type_equip:w.subtype||'AUTRE'});
        else if(w.type==='noeud')       await sbInsert(cfg,'noeud_cheminement',{...base, type_noeud:w.subtype||'INTERSECTION'});
        else                            await sbInsert(cfg,'point_autre',      {...base, sous_type:w.subtype});
        ok++;
      } catch(e){ errs++; console.warn(e); }
    }
    for(const trk of S.tracks){
      if(!trk.pts||trk.pts.length<2) continue;
      const coords = trk.pts.map(p=>`${p.lon} ${p.lat}`).join(',');
      try {
        await sbInsert(cfg,'troncon_cheminement',{session_id:sessionId, geom:`SRID=4326;LINESTRING(${coords})`, nom:trk.name, nb_points_gps:trk.pts.length});
        ok++;
      } catch(e){ errs++; console.warn(e); }
    }
    localStorage.setItem('ldm_last_session_id', sessionId);
    const now = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    localStorage.setItem('ldm_last_sync_time', now);
    const lastEl = document.getElementById('sync-last');
    const lastTm = document.getElementById('sync-last-time');
    if(lastEl) lastEl.style.display='block';
    if(lastTm) lastTm.textContent = now;
    toast(`✓ ${ok} éléments envoyés vers TickS SIG${errs?` (${errs} erreurs)`:''}`, errs?'a':'g');
  } catch(e){
    if(!navigator.onLine || e.message?.includes('fetch') || e.name==='TypeError'){
      try {
        const rows = [];
        for(const w of S.waypoints){
          const geom=`SRID=4326;POINT(${w.lon} ${w.lat})`;
          const base={id:w.id,geom,nom:w.name,precision_gps:w.acc,nb_mesures_gps:w.samples||null,notes:w.desc||null};
          let table='point_autre', data={...base,sous_type:w.subtype};
          if(w.type==='entree')       {table='entree_batiment';  data={...base,type_entree:w.subtype||'PRINCIPALE'};}
          else if(w.type==='equip_acces'){table='equipement_acces';data={...base,type_equip:w.subtype||'AUTRE'};}
          else if(w.type==='equip_comp') {table='equipement_info'; data={...base,type_equip:w.subtype||'AUTRE'};}
          else if(w.type==='noeud')   {table='noeud_cheminement';data={...base,type_noeud:w.subtype||'INTERSECTION'};}
          rows.push({table, data});
        }
        for(const trk of S.tracks){
          if(!trk.pts||trk.pts.length<2) continue;
          const coords=trk.pts.map(p=>`${p.lon} ${p.lat}`).join(',');
          rows.push({table:'troncon_cheminement',data:{geom:`SRID=4326;LINESTRING(${coords})`,nom:trk.name,nb_points_gps:trk.pts.length}});
        }
        const sessionId = crypto.randomUUID ? crypto.randomUUID() : 'ses-'+Date.now();
        const sessionNom = cfg.nomSession || `Session ${new Date().toLocaleDateString('fr-FR')}`;
        const finalRows = rows.map(r=>({...r, data:{...r.data, session_id:sessionId}}));
        await queuePush({sessionId, sessionNom, rows:finalRows});
        await updateQueueBadge();
        toast(`📤 Hors ligne — ${rows.length} élément(s) en file d'attente`,'a');
      } catch(qErr){ toast(`Erreur sync : ${e.message}`,'r'); }
    } else { toast(`Erreur sync : ${e.message}`,'r'); }
  } finally {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Synchroniser vers TickS SIG';
    btn.disabled = false;
  }
}
function exportGPX(){
  if(!S.waypoints.length&&!S.tracks.length){toast('Rien à exporter','a');return;}
  const ts=new Date().toISOString();
  let g=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TickS Terrain" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><n>Session LDM</n><time>${ts}</time></metadata>\n`;
  S.waypoints.forEach(w=>{
    const name=`[${w.type.toUpperCase()}] ${w.name}`;
    const desc=[w.subtype,w.desc].filter(Boolean).join(' | ');
    g+=`<wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">\n  <n>${xe(name)}</n>\n  <desc>${xe(desc)}</desc>\n  <time>${new Date(w.ts).toISOString()}</time>\n</wpt>\n`;
  });
  S.tracks.forEach(t=>{
    if(!t.pts||t.pts.length<2)return;
    g+=`<trk>\n  <n>${xe(t.name)}</n>\n  <trkseg>\n`;
    t.pts.forEach(p=>{g+=`    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.ts).toISOString()}</time></trkpt>\n`;});
    g+=`  </trkseg>\n</trk>\n`;
  });
  g+='</gpx>';
  dl(g,'application/gpx+xml',`LDM_terrain_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.gpx`,'GPX exporté');
}
function exportJSON(){
  dl(JSON.stringify({waypoints:S.waypoints,tracks:S.tracks,v:1},null,2),'application/json',`session_ldm_${new Date().toISOString().slice(0,10)}.json`,'Session sauvegardée');
}
function loadSession(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();r.onload=ev=>{
      try{const d=JSON.parse(ev.target.result);if(!d.waypoints)throw 0;
        S.waypoints=d.waypoints||[];S.tracks=d.tracks||[];save();renderPts();renderExp();
        toast(`${S.waypoints.length} pts, ${S.tracks.length} tronçons chargés`,'g');
      }catch(e){toast('Fichier invalide','r');}
    };r.readAsText(f);
  };inp.click();
}
function resetSession(){
  if(!confirm('Effacer toute la session ?'))return;
  S.waypoints=[];S.tracks=[];localStorage.removeItem('ldm_session');
  renderPts();renderExp();refreshMap();toast('Session effacée','a');
}
function save(){try{localStorage.setItem('ldm_session',JSON.stringify({waypoints:S.waypoints,tracks:S.tracks}));}catch(e){}}
function load(){
  try{const d=JSON.parse(localStorage.getItem('ldm_session')||'null');
    if(d){S.waypoints=d.waypoints||[];S.tracks=d.tracks||[];
      if(S.waypoints.length||S.tracks.length) toast(`Session restaurée — ${S.waypoints.length} pts, ${S.tracks.length} tronçons`,'a');
    }
  }catch(e){}
}
function hav(a,b){const R=6371000,dL=(b.lat-a.lat)*Math.PI/180,dO=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(dL/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dO/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function xe(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
let _tt;
function toast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='show '+(type||'');clearTimeout(_tt);_tt=setTimeout(()=>t.className='',2600);}
async function dl(content,mime,filename,msg){
  const blob=new Blob([content],{type:mime});
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  if(ios&&navigator.canShare&&navigator.canShare({files:[new File([blob],filename,{type:mime})]})){
    try{await navigator.share({files:[new File([blob],filename,{type:mime})],title:filename});if(msg)toast(msg,'g');return;}catch(e){if(e.name==='AbortError')return;}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  if(msg)toast(msg,'g');
}
let WAKE_LOCK=null;
async function requestWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{ WAKE_LOCK=await navigator.wakeLock.request('screen'); WAKE_LOCK.addEventListener('release',()=>{WAKE_LOCK=null;}); }catch(e){}
}
function releaseWakeLock(){ if(WAKE_LOCK){WAKE_LOCK.release();WAKE_LOCK=null;} }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&S.recording&&!S.paused) requestWakeLock(); });
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){if(!S.recording&&GPS_WATCH_ID!==null){navigator.geolocation.clearWatch(GPS_WATCH_ID);GPS_WATCH_ID=null;}}
  else if(document.visibilityState==='visible'){if(GPS_WATCH_ID===null) launchWatch(S.recording&&!S.paused);}
});
load();
startGPS();
function _bootMap(){
  initMap(); resizeMap();
  [200,600,1200].forEach(ms=>setTimeout(()=>{if(MAP)MAP.invalidateSize();resizeMap();},ms));
  new ResizeObserver(()=>{resizeMap();if(MAP)MAP.invalidateSize();}).observe(document.getElementById('sheet'));
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>setTimeout(_bootMap,100));
}else{setTimeout(_bootMap,100);}
['avg-modal','wpt-modal','edit-modal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',e=>{
    if(e.target===document.getElementById(id)){document.getElementById(id).classList.remove('open');if(id==='avg-modal')cancelAvg();}
  });
});
function openBurger(){document.getElementById('burger-menu').classList.add('open');}
function closeBurger(){document.getElementById('burger-menu').classList.remove('open');}
function toggleFilterPopover(){const p=document.getElementById('filter-popover');const b=document.getElementById('btn-filter-toggle');const open=p.classList.toggle('open');b.classList.toggle('active',open);}
function closeFilterPopover(){const p=document.getElementById('filter-popover');const b=document.getElementById('btn-filter-toggle');if(p)p.classList.remove('open');if(b)b.classList.remove('active');}
document.addEventListener('click',e=>{if(!e.target.closest('#filter-popover')&&!e.target.closest('#btn-filter-toggle'))closeFilterPopover();},true);
function applyFilter(f,btn){
  MAP_FILTER=f;
  document.querySelectorAll('#filter-popover button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  refreshMap();
  closeFilterPopover();
}
function goTab(id){
  const terrain=document.getElementById('pane-terrain');
  const pts=document.getElementById('pane-points');
  const exp=document.getElementById('pane-export');
  if(terrain)terrain.style.display=id==='terrain'?'block':'none';
  if(pts)pts.style.display=id==='points'?'flex':'none';
  if(exp)exp.style.display=id==='export'?'flex':'none';
  document.querySelectorAll('.bmenu-item').forEach(b=>{b.classList.toggle('active',b.dataset.view===id);});
  if(id==='terrain'){setTimeout(()=>{if(MAP)MAP.invalidateSize();},100);initMap();}
  if(id==='points') renderPts();
  if(id==='export') renderExp();
  closeBurger();
  if(typeof closeFilterPopover==='function')closeFilterPopover();
}

// ══════════════════════════════════
// GESTIONNAIRE D'ERREUR GLOBAL
// Capture les crashs silencieux et affiche un toast
// ══════════════════════════════════
const APP_VERSION = '1.3.0';

window.addEventListener('error', e => {
  console.error('[TickS] Erreur non capturée :', e.message, e.filename, e.lineno);
  try {
    if(document.getElementById('toast'))
      toast('Erreur : ' + (e.message||'inconnue').slice(0,40), 'r');
  } catch(_) {}
  return false;
});

window.addEventListener('unhandledrejection', e => {
  console.error('[TickS] Promise rejetée :', e.reason);
  try {
    const msg = (e.reason?.message || String(e.reason) || 'Promise rejetée').slice(0,40);
    if(document.getElementById('toast')) toast('Erreur async : ' + msg, 'r');
  } catch(_) {}
});

// Afficher la version dans le burger menu si l'élément existe
document.addEventListener('DOMContentLoaded', () => {
  const vEl = document.getElementById('app-version');
  if(vEl) vEl.textContent = 'v' + APP_VERSION;
  updateQueueBadge();
});

console.log('[TickS Terrain] v' + APP_VERSION + ' — prêt');
