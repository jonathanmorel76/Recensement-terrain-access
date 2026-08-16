// worker.mjs — TickS Terrain
// Relais Overpass, a deployer sur Cloudflare Workers.
//
// POURQUOI PAS VERCEL
// -------------------
// Overpass bloque les plages d'adresses AWS et Azure depuis octobre 2025,
// pour preserver le service d'un usage abusif depuis le cloud (annonce :
// community.openstreetmap.org/t/136817). Vercel s'execute sur AWS : ses
// requetes sont donc silencieusement rejetees, ce qui se manifeste par des
// depassements de delai sur TOUS les miroirs a la fois, sans code d'erreur.
// Symptome trompeur : on cherche une panne reseau ou une requete trop lourde
// alors que c'est l'adresse d'origine qui est refusee.
//
// Cloudflare Workers ne releve d'aucun des deux fournisseurs bloques.
//
// DEPLOIEMENT
// -----------
//   npm install -g wrangler
//   wrangler login
//   wrangler deploy worker.mjs --name ticks-overpass --compatibility-date 2026-01-01
//
// L'URL obtenue (https://ticks-overpass.<compte>.workers.dev) se colle dans
// l'app : menu, Reference OSM, champ « Relais Overpass ».

const MIROIRS = [
  // Instance francaise, hebergee par OSM-FR : la plus proche pour des donnees
  // normandes, et generalement moins sollicitee que l'instance principale.
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

// Overpass journalise le User-Agent et le Referer pour distinguer les usages
// legitimes des scripts anonymes. Les renseigner est la condition pour ne pas
// etre confondu avec ces derniers.
const UA = 'TickS-Terrain/2.8 (recensement accessibilite gares normandes; jonathanmorel76 sur GitHub)';

const BUDGET_MS = 40000;
const PAR_MIROIR_MS = 15000;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});

    const url = new URL(request.url);
    let ql = url.searchParams.get('data');
    if (!ql && request.method === 'POST') {
      const brut = await request.text();
      ql = new URLSearchParams(brut).get('data') || brut;
    }
    if (!ql) return json({erreur:'parametre data manquant'}, 400, cors);
    if (ql.length > 8000) return json({erreur:'requete trop longue'}, 413, cors);

    const echecs = [];
    const debut = Date.now();

    for (const cible of MIROIRS) {
      const reste = BUDGET_MS - (Date.now() - debut);
      const hote = new URL(cible).hostname;
      if (reste < 3000) {
        echecs.push({hote, statut:0, message:'non interroge : budget de temps epuise'});
        continue;
      }
      try {
        const r = await fetch(cible, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
            'Accept': 'application/json'
          },
          body: 'data=' + encodeURIComponent(ql),
          signal: AbortSignal.timeout(Math.min(PAR_MIROIR_MS, reste))
        });

        if (!r.ok) {
          const brut = await r.text().catch(() => '');
          const net = brut.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
          echecs.push({hote, statut:r.status, message: net || motif(r.status)});
          continue;
        }
        const type = r.headers.get('content-type') || '';
        if (!/json/i.test(type)) {
          echecs.push({hote, statut:r.status, message:'reponse non-JSON (' + type.split(';')[0] + ')'});
          continue;
        }
        const data = await r.json();
        // Overpass repond 200 avec un « remark » quand la requete est fautive
        // ou trop lourde : sans ce test on croirait a un resultat vide.
        if (data.remark) {
          echecs.push({hote, statut:200, message:String(data.remark).slice(0,180)});
          continue;
        }
        return json(data, 200, {...cors, 'X-Overpass-Miroir':hote,
          'Cache-Control':'public, max-age=3600'});
      } catch (e) {
        echecs.push({hote, statut:0,
          message: e.name === 'TimeoutError' ? 'delai depasse' : String(e.message || e)});
      }
    }
    // 502 : l'echec vient des services amont, pas du relais.
    return json({erreur:'aucun miroir Overpass disponible', echecs}, 502, cors);
  }
};

function json(obj, statut, headers){
  return new Response(JSON.stringify(obj), {status:statut,
    headers:{'Content-Type':'application/json; charset=utf-8', ...headers}});
}

function motif(code){
  if (code === 400) return 'requete refusee (syntaxe Overpass)';
  if (code === 403) return 'acces refuse (plage IP bloquee)';
  if (code === 406) return 'refus du serveur (identification client)';
  if (code === 429) return 'quota atteint, reessayer dans quelques minutes';
  if (code === 504) return 'delai serveur depasse, reduire le rayon';
  return 'HTTP ' + code;
}
