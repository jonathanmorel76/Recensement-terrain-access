// TickS Terrain — auth.js
// Connexion Supabase Auth (API REST GoTrue, sans supabase-js).
//
// Principe : la saisie terrain n'exige JAMAIS d'etre connecte. Seul l'envoi
// vers Supabase le demande. Un operateur sans reseau ou sans compte continue
// de relever ; ses donnees restent sur l'appareil ou en file d'attente.
//
// Depuis l'activation de la RLS, la cle anon seule ne donne plus acces aux
// tables : chaque requete porte le jeton de l'utilisateur connecte.
// Charge AVANT sync.js (qui appelle Auth.token / Auth.email).

const Auth = (() => {
  const KEY = 'ldm_auth';
  let apresConnexion = null;

  const lire = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const ecrire = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const effacer = () => localStorage.removeItem(KEY);

  function erreurAuth(msg) { const e = new Error(msg || 'Connexion requise'); e.name = 'AuthRequired'; return e; }

  function depuisReponse(j) {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: j.user?.email || lire()?.email || '',
    };
  }

  const MESSAGES = {
    invalid_credentials: 'Email ou mot de passe incorrect.',
    'Invalid login credentials': 'Email ou mot de passe incorrect.',
    email_not_confirmed: "Compte non confirmé : demandez à l'administrateur de le valider.",
    'Email not confirmed': "Compte non confirmé : demandez à l'administrateur de le valider.",
    same_password: "Le nouveau mot de passe doit être différent de l'actuel.",
    weak_password: 'Mot de passe trop faible (8 caractères minimum).',
  };
  async function messageErreur(r) {
    let j = {}; try { j = await r.json(); } catch (e) {}
    return MESSAGES[j.error_code] || MESSAGES[j.msg] || MESSAGES[j.error_description]
      || j.msg || j.error_description || j.message || `Erreur ${r.status}`;
  }

  async function connexion(cfg, email, password) {
    const r = await fetch(`${cfg.sbUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.sbKey },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await messageErreur(r));
    ecrire(depuisReponse(await r.json()));
  }

  async function rafraichir(cfg, s) {
    // Un echec reseau remonte tel quel (TypeError) : sync.js le traite comme
    // « hors ligne » et met le lot en file, sans deconnecter l'operateur.
    const r = await fetch(`${cfg.sbUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.sbKey },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (r.status === 400 || r.status === 401) { effacer(); renderAuth(); throw erreurAuth('Session expirée, reconnectez-vous'); }
    if (!r.ok) throw new Error(`Rafraîchissement de session : ${r.status}`);
    const n = depuisReponse(await r.json());
    ecrire(n);
    return n;
  }

  // Jeton valide pour la prochaine requete (renouvele 60 s avant expiration).
  async function token(cfg) {
    let s = lire();
    if (!s) throw erreurAuth();
    if (s.expires_at - 60 <= Date.now() / 1000) s = await rafraichir(cfg, s);
    return s.access_token;
  }

  async function deconnexion() {
    const cfg = getSyncCfg(), s = lire();
    effacer(); renderAuth();
    if (s && cfg.sbUrl && navigator.onLine) {
      fetch(`${cfg.sbUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: cfg.sbKey, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
    }
    toast('Déconnecté', 'a');
  }

  async function changerMotDePasse(cfg, password) {
    const t = await token(cfg);
    const r = await fetch(`${cfg.sbUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: cfg.sbKey, Authorization: `Bearer ${t}` },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) throw new Error(await messageErreur(r));
  }

  // ---------- Interface ----------
  const $ = (id) => document.getElementById(id);
  function msg(txt) { const m = $('auth-msg'); m.textContent = txt || ''; m.style.display = txt ? 'block' : 'none'; }

  function ouvrir(mode, suite) {
    const cfg = getSyncCfg();
    if (!cfg.sbUrl || !cfg.sbKey) { openSyncConfig(); toast('Renseignez d’abord la connexion Supabase', 'a'); return; }
    apresConnexion = suite || null;
    const mdp = mode === 'mdp';
    $('auth-modal').dataset.mode = mode;
    $('auth-title').textContent = mdp ? 'Changer mon mot de passe' : 'Connexion';
    $('auth-sub').textContent = mdp ? (lire()?.email || '') : 'Nécessaire pour envoyer vos relevés';
    $('auth-email-row').style.display = mdp ? 'none' : 'block';
    $('auth-pwd-label').textContent = mdp ? 'Nouveau mot de passe (8 caractères min.)' : 'Mot de passe';
    $('auth-pwd').autocomplete = mdp ? 'new-password' : 'current-password';
    $('auth-pwd').value = '';
    $('auth-ok').textContent = mdp ? 'Enregistrer' : 'Se connecter';
    if (!mdp) $('auth-email').value = lire()?.email || localStorage.getItem('ldm_auth_last_email') || '';
    msg(!navigator.onLine ? 'Hors ligne : la connexion nécessite du réseau.' : '');
    $('auth-modal').classList.add('open');
    setTimeout(() => (mdp || $('auth-email').value ? $('auth-pwd') : $('auth-email')).focus(), 80);
  }
  function fermer() { $('auth-modal').classList.remove('open'); apresConnexion = null; }

  async function valider() {
    const cfg = getSyncCfg(), mode = $('auth-modal').dataset.mode;
    const email = $('auth-email').value.trim(), pwd = $('auth-pwd').value;
    const btn = $('auth-ok'), libelle = btn.textContent;
    if (!navigator.onLine) return msg('Hors ligne : réessayez une fois le réseau revenu.');
    if (mode === 'mdp' && pwd.length < 8) return msg('8 caractères minimum.');
    if (mode !== 'mdp' && (!email || !pwd)) return msg('Renseignez votre email et votre mot de passe.');
    btn.disabled = true; btn.textContent = '…';
    try {
      if (mode === 'mdp') { await changerMotDePasse(cfg, pwd); toast('Mot de passe modifié', 'g'); fermer(); return; }
      await connexion(cfg, email, pwd);
      localStorage.setItem('ldm_auth_last_email', email);
      const suite = apresConnexion;
      fermer(); renderAuth();
      toast('Connecté : ' + email, 'g');
      flushQueue();                 // envoie ce qui attendait une connexion
      if (suite) suite();
    } catch (e) {
      msg(e.name === 'TypeError' ? 'Réseau indisponible.' : e.message);
    } finally { btn.disabled = false; btn.textContent = libelle; }
  }

  // Ligne « Connecté : … » dans la carte d'envoi
  function renderAuth() {
    const row = $('auth-status-row'); if (!row) return;
    const s = lire();
    $('auth-status-txt').textContent = s ? 'Connecté : ' + s.email : 'Non connecté';
    $('auth-btn-login').style.display = s ? 'none' : 'inline-block';
    $('auth-btn-pwd').style.display = s ? 'inline-block' : 'none';
    $('auth-btn-logout').style.display = s ? 'inline-block' : 'none';
  }
  document.addEventListener('DOMContentLoaded', renderAuth);

  return {
    token,
    email: () => lire()?.email || null,
    connecte: () => !!lire(),
    ouvrir, fermer, valider, deconnexion, renderAuth,
  };
})();
