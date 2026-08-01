// TickS Terrain — sync.js
// Rendu listes, Sync Supabase, Exports, File offline
// NOTE : WAKE_LOCK / requestWakeLock / releaseWakeLock / esc / hav
// sont definis dans app.js (ne PAS les redeclarer ici : SyntaxError)

function renderExp(){
  const cfg=getSyncCfg();
  const dot=document.getElementById('sync-dot');
  const stxt=document.getElementById('sync-status-txt');
  const cfgRow=document.getElementById('sync-cfg-row');
  const lastEl=document.getElementById('sync-last');
  const lastTs=localStorage.getItem('ldm_last_sync_time');
  if(dot&&stxt){
    if(cfg.sbUrl){dot.style.background='var(--green,#34C759)';stxt.textContent=cfg.sbUrl.replace('https://','').slice(0,32)+'…';}
    else{dot.style.background='var(--txt3)';stxt.textContent='Non configuré — tapez ⚙';}
  }
  if(lastEl&&lastTs){lastEl.style.display='block';document.getElementById('sync-last-time').textContent=lastTs;}
  if(cfgRow)cfgRow.style.display=cfg.sbUrl?'none':'block';
  updateQueueBadge();
  const counts={};
  S.waypoints.forEach(w=>counts[w.type]=(counts[w.type]||0)+1);
  document.getElementById('exp-stats').innerHTML=
    Object.entries(counts).map(([t,n])=>`<div class="stat-chip"><span class="n" style="color:${COLORS[t]||'#888'}">${n}</span><span style="font-size:12px;color:var(--txt2)">${t}</span></div>`).join('')+
    (S.tracks.length?`<div class="stat-chip"><span class="n" style="color:#4ade80">${S.tracks.length}</span><span style="font-size:12px;color:var(--txt2)">tronçons</span></div>`:'');
  const cfgBtn=document.getElementById('sync-cfg-row');
  if(cfgBtn)cfgBtn.style.display=getSyncCfg().sbUrl?'none':'flex';
}

function getSyncCfg(){
  return{sbUrl:localStorage.getItem('ldm_sb_url')||'',sbKey:localStorage.getItem('ldm_sb_key')||'',nomSession:localStorage.getItem('ldm_nom_session')||''};
}
function openSyncConfig(){
  document.getElementById('sync-modal').classList.add('open');
  const cfg=getSyncCfg();
  document.getElementById('sc-sb-url').value=cfg.sbUrl;
  document.getElementById('sc-sb-key').value=cfg.sbKey;
  document.getElementById('sc-nom').value=cfg.nomSession;
}
function closeSyncConfig(){document.getElementById('sync-modal').classList.remove('open');}
function saveSyncConfig(){
  localStorage.setItem('ldm_sb_url',document.getElementById('sc-sb-url').value.trim().replace(/\/$/,''));
  localStorage.setItem('ldm_sb_key',document.getElementById('sc-sb-key').value.trim());
  localStorage.setItem('ldm_nom_session',document.getElementById('sc-nom').value.trim());
  closeSyncConfig();toast('Configuration enregistrée','g');renderExp();
}

// Precision moyenne des points d'un troncon. Le schema prevoit la colonne
// precision_moy depuis le debut mais elle n'etait jamais renseignee.
function precisionMoy(trk){
  const a=(trk.pts||[]).map(p=>p.acc).filter(x=>typeof x==='number');
  if(!a.length)return null;
  return Math.round((a.reduce((s,x)=>s+x,0)/a.length)*10)/10;
}

// Payload commun a toutes les tables de points.
// mode_saisie : 'gps' (moyennage pondere sur site) ou 'manuel' (pointe sur
// la carte). A NE PAS confondre avec la colonne `source` du schema, qui
// vaut 'terrain_ldm' et designe la provenance de l'enregistrement, pas la
// methode de positionnement.
// Un point manuel envoie precision_gps et nb_mesures_gps a NULL : mettre 0
// se lirait comme "precision parfaite", ce qui serait faux.
function basePoint(w, sessionId){
  const manuel = w.source==='manuel';
  const base={
    id:w.id,
    geom:`SRID=4326;POINT(${w.lon} ${w.lat})`,
    nom:w.name,
    precision_gps: manuel ? null : (w.acc||null),
    nb_mesures_gps: manuel ? null : (w.samples||null),
    mode_saisie: manuel ? 'manuel' : 'gps',
    notes:w.desc||null
  };
  if(sessionId) base.session_id=sessionId;
  return base;
}

// Aiguillage type -> table CNIG. Une seule definition, utilisee par le
// chemin en ligne ET par la file d'attente hors ligne : les deux ne
// peuvent plus diverger.
function routePoint(w, sessionId){
  const base=basePoint(w, sessionId);
  if(w.type==='entree')      return {table:'entree_batiment',  data:{...base,type_entree:w.subtype||'PRINCIPALE'}};
  if(w.type==='equip_acces') return {table:'equipement_acces', data:{...base,type_equip:w.subtype||'AUTRE'}};
  if(w.type==='equip_comp')  return {table:'equipement_info',  data:{...base,type_equip:w.subtype||'AUTRE'}};
  if(w.type==='noeud')       return {table:'noeud_cheminement',data:{...base,type_noeud:w.subtype||'INTERSECTION'}};
  return {table:'point_autre', data:{...base,sous_type:w.subtype}};
}

function routeTrack(trk, sessionId){
  const coords=trk.pts.map(p=>`${p.lon} ${p.lat}`).join(',');
  const data={
    geom:`SRID=4326;LINESTRING(${coords})`,
    nom:trk.name,
    nb_points_gps:trk.pts.length,
    precision_moy:precisionMoy(trk),
    mode_saisie:'gps'
  };
  if(sessionId) data.session_id=sessionId;
  return {table:'troncon_cheminement', data};
}

async function sbInsert(cfg,table,row){
  const r=await fetch(`${cfg.sbUrl}/rest/v1/${table}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.sbKey,'Authorization':`Bearer ${cfg.sbKey}`,'Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});
  if(!r.ok){const e=await r.text();throw new Error(`${table}: ${r.status} ${e}`);}
}

// FILE D'ATTENTE OFFLINE
const QUEUE_DB='ticks-offline-queue',QUEUE_VER=1;
function openQueueDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(QUEUE_DB,QUEUE_VER);
    req.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'id',autoIncrement:true});};
    req.onsuccess=e=>res(e.target.result);req.onerror=e=>rej(e.target.error);
  });
}
async function queuePush(payload){
  const db=await openQueueDB();
  return new Promise((res,rej)=>{const tx=db.transaction('queue','readwrite');const req=tx.objectStore('queue').add({...payload,queuedAt:Date.now()});req.onsuccess=()=>res(req.result);req.onerror=e=>rej(e.target.error);});
}
async function queueGetAll(){
  const db=await openQueueDB();
  return new Promise((res,rej)=>{const tx=db.transaction('queue','readonly');const req=tx.objectStore('queue').getAll();req.onsuccess=()=>res(req.result);req.onerror=e=>rej(e.target.error);});
}
async function queueDelete(id){
  const db=await openQueueDB();
  return new Promise((res,rej)=>{const tx=db.transaction('queue','readwrite');const req=tx.objectStore('queue').delete(id);req.onsuccess=()=>res();req.onerror=e=>rej(e.target.error);});
}
async function queueCount(){
  const db=await openQueueDB();
  return new Promise((res,rej)=>{const tx=db.transaction('queue','readonly');const req=tx.objectStore('queue').count();req.onsuccess=()=>res(req.result);req.onerror=()=>res(0);});
}
async function flushQueue(){
  let pending;try{pending=await queueGetAll();}catch(e){return;}
  if(!pending.length)return;
  toast(`Reconnexion — envoi de ${pending.length} session(s)…`,'a');
  let ok=0,fail=0;
  for(const entry of pending){try{await replaySync(entry);await queueDelete(entry.id);ok++;}catch(e){fail++;console.warn('Queue flush error:',e);}}
  updateQueueBadge();
  if(ok>0)toast(`✓ ${ok} session(s) synchronisée(s)`,'g');
  if(fail>0)toast(`${fail} session(s) en attente`,'r');
}
async function replaySync(entry){
  const cfg=getSyncCfg();if(!cfg.sbUrl||!cfg.sbKey)throw new Error('Non configuré');
  await sbInsert(cfg,'session_terrain',{id:entry.sessionId,nom:entry.sessionNom,statut:'en_cours'});
  for(const row of(entry.rows||[]))await sbInsert(cfg,row.table,row.data);
}
async function updateQueueBadge(){
  let count=0;try{count=await queueCount();}catch(e){}
  const row=document.getElementById('queue-status-row');
  if(row)row.style.display=count>0?'flex':'none';
  const label=document.getElementById('queue-label');
  if(label&&count>0)label.textContent=`${count} session(s) en attente d'envoi`;
}
window.addEventListener('online',()=>{flushQueue();});
window.addEventListener('offline',()=>{toast('Hors ligne — sync en attente','a');});
document.addEventListener('DOMContentLoaded',()=>{updateQueueBadge();});

async function syncToCloud(){
  if(!S.waypoints.length&&!S.tracks.length){toast('Rien à synchroniser','a');return;}
  const cfg=getSyncCfg();if(!cfg.sbUrl||!cfg.sbKey){openSyncConfig();return;}
  const btn=document.getElementById('btn-sync');btn.textContent='↑ Synchronisation…';btn.disabled=true;
  try{
    const sessionId=crypto.randomUUID?crypto.randomUUID():'ses-'+Date.now();
    await sbInsert(cfg,'session_terrain',{id:sessionId,nom:cfg.nomSession||`Session ${new Date().toLocaleDateString('fr-FR')}`,statut:'en_cours'});
    let ok=0,errs=0;
    for(const w of S.waypoints){
      const {table,data}=routePoint(w, sessionId);
      try{await sbInsert(cfg,table,data);ok++;}
      catch(e){errs++;console.warn('[TickS] Echec insert',table,e);}
    }
    for(const trk of S.tracks){
      if(!trk.pts||trk.pts.length<2)continue;
      const {table,data}=routeTrack(trk, sessionId);
      try{await sbInsert(cfg,table,data);ok++;}
      catch(e){errs++;console.warn('[TickS] Echec insert',table,e);}
    }
    localStorage.setItem('ldm_last_session_id',sessionId);
    const now=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    localStorage.setItem('ldm_last_sync_time',now);
    const lastEl=document.getElementById('sync-last'),lastTm=document.getElementById('sync-last-time');
    if(lastEl)lastEl.style.display='block';if(lastTm)lastTm.textContent=now;
    toast(`✓ ${ok} éléments envoyés${errs?` (${errs} erreurs)`:''}`,errs?'a':'g');
  }catch(e){
    if(!navigator.onLine||e.message?.includes('fetch')||e.name==='TypeError'){
      try{
        const sessionId=crypto.randomUUID?crypto.randomUUID():'ses-'+Date.now();
        const rows=[];
        for(const w of S.waypoints) rows.push(routePoint(w, sessionId));
        for(const trk of S.tracks){
          if(!trk.pts||trk.pts.length<2)continue;
          rows.push(routeTrack(trk, sessionId));
        }
        const sessionNom=cfg.nomSession||`Session ${new Date().toLocaleDateString('fr-FR')}`;
        await queuePush({sessionId,sessionNom,rows});
        await updateQueueBadge();
        toast(`Hors ligne — ${rows.length} élément(s) en file`,'a');
      }catch(qErr){toast(`Erreur sync : ${e.message}`,'r');}
    }else{toast(`Erreur sync : ${e.message}`,'r');}
  }finally{
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Synchroniser vers TickS SIG';
    btn.disabled=false;
  }
}

function exportGPX(){
  if(!S.waypoints.length&&!S.tracks.length){toast('Rien à exporter','a');return;}
  const ts=new Date().toISOString();
  let g=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TickS Terrain" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>Session LDM</name><time>${ts}</time></metadata>\n`;
  S.waypoints.forEach(w=>{g+=`<wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">\n  <name>${xe(w.name)}</name>\n  <desc>${xe([w.subtype,w.desc,w.source==='manuel'?'point\u00e9 sur la carte':null].filter(Boolean).join(' | '))}</desc>\n  <time>${new Date(w.ts).toISOString()}</time>\n</wpt>\n`;});
  S.tracks.forEach(t=>{if(!t.pts||t.pts.length<2)return;g+=`<trk>\n  <name>${xe(t.name)}</name>\n  <trkseg>\n`;t.pts.forEach(p=>{g+=`    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.ts).toISOString()}</time></trkpt>\n`;});g+=`  </trkseg>\n</trk>\n`;});
  g+='</gpx>';
  dl(g,'application/gpx+xml',`LDM_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.gpx`,'GPX exporté');
}
function exportJSON(){
  dl(JSON.stringify({waypoints:S.waypoints,tracks:S.tracks,v:1},null,2),'application/json',`session_${new Date().toISOString().slice(0,10)}.json`,'Session sauvegardée');
}
function loadSession(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(!d.waypoints)throw 0;S.waypoints=d.waypoints||[];S.tracks=d.tracks||[];save();renderPts();renderExp();toast(`${S.waypoints.length} pts, ${S.tracks.length} tronçons chargés`,'g');}catch(e){toast('Fichier invalide','r');}};r.readAsText(f);};inp.click();
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
      if(S.waypoints.length||S.tracks.length)toast(`Session restaurée — ${S.waypoints.length} pts`,'a');
    }
  }catch(e){}
}

function xe(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
let _tt;
function toast(msg,type=''){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.className='show '+(type||'');clearTimeout(_tt);_tt=setTimeout(()=>t.className='',2600);}
async function dl(content,mime,filename,msg){
  const blob=new Blob([content],{type:mime});
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  if(ios&&navigator.canShare&&navigator.canShare({files:[new File([blob],filename,{type:mime})]})){ try{await navigator.share({files:[new File([blob],filename,{type:mime})],title:filename});if(msg)toast(msg,'g');return;}catch(e){if(e.name==='AbortError')return;} }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  if(msg)toast(msg,'g');
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.recording&&!S.paused)requestWakeLock();});

function goTab(id){
  const terrain=document.getElementById('pane-terrain');
  const pts=document.getElementById('pane-points');
  const exp=document.getElementById('pane-export');
  if(terrain)terrain.style.display=id==='terrain'?'block':'none';
  if(pts)pts.style.display=id==='points'?'flex':'none';
  if(exp)exp.style.display=id==='export'?'flex':'none';
  document.querySelectorAll('.bmenu-item').forEach(b=>{b.classList.toggle('active',b.dataset.view===id);});
  if(id==='terrain'){setTimeout(()=>{if(MAP)MAP.invalidateSize();},100);}
  if(id==='points')renderPts();
  if(id==='export')renderExp();
  closeBurger();
  closeFilterPopover();
}

// FIX MOBILE : empecher Leaflet d'intercepter les clics sur les overlays.
// Tout nouvel element flottant DOIT etre ajoute ici, sinon ses clics
// partent a la carte. btn-geolocate, manual-bar et pick-bar sont des
// enfants de #sheet mais on les liste explicitement par securite.
(function fixLeafletOverlays(){
  function applyFix(){
    if(typeof L === 'undefined' || typeof MAP_OK === 'undefined' || !MAP_OK){
      setTimeout(applyFix, 300); return;
    }
    ['sheet','wpt-cluster','right-pill','filter-popover','btn-geolocate',
     'manual-bar','pick-bar',
     'burger-btn','gps-bar','burger-menu','burger-panel',
     'avg-modal','wpt-modal','edit-modal','sync-modal','toast'].forEach(id => {
      const el = document.getElementById(id);
      if(el){
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
      }
    });
    console.log('[TickS] Overlays Leaflet proteges');
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => setTimeout(applyFix, 600));
  } else {
    setTimeout(applyFix, 600);
  }
})();

// ═══ BOOT ═══
// Deplace ici depuis app.js : sync.js charge en DERNIER,
// donc load() / save() / toast() sont tous definis a ce stade.
load();
startGPS();

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>setTimeout(_bootMap,100));
}else{
  setTimeout(_bootMap,100);
}

['avg-modal','wpt-modal','edit-modal'].forEach(id=>{
  const el=document.getElementById(id);
  if(el)el.addEventListener('click',e=>{
    if(e.target===el){el.classList.remove('open');if(id==='avg-modal')cancelAvg();}
  });
});

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&!S.recording&&GPS_WATCH_ID!==null){
    navigator.geolocation.clearWatch(GPS_WATCH_ID);GPS_WATCH_ID=null;
  }else if(document.visibilityState==='visible'&&GPS_WATCH_ID===null){
    launchWatch(S.recording&&!S.paused);
  }
});