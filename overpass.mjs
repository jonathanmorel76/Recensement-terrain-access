// api/overpass.mjs — TickS Terrain
//
// EMPLACEMENT ET EXTENSION, tous deux imposes :
//   * le dossier api/ est ce qui fait de ce fichier une fonction serveur.
//     A la racine du depot, il serait servi comme un simple fichier statique
//     et /api/overpass renverrait 404.
//   * l'extension .mjs force l'interpretation en module ES. Le depot n'ayant
//     pas de package.json, un .js serait lu en CommonJS et le « export
//     default » ci-dessous echouerait au demarrage.
//
// Relais serveur vers Overpass. Fonction Vercel, deployee automatiquement
// par la presence de ce fichier dans api/ ; aucune configuration a ajouter
// dans vercel.json.
//
// POURQUOI PASSER PAR UN RELAIS
// -----------------------------
// Depuis le navigateur, trois obstacles se cumulaient et se confondaient
// dans un unique « Load failed » cote Safari :
//
//   1. CORS. Quand un miroir repond en erreur (406, 429, 504), sa reponse
//      ne porte pas toujours les en-tetes CORS. Le navigateur transforme
//      alors une erreur HTTP parfaitement lisible en echec reseau opaque :
//      impossible de savoir si c'est un quota, une panne ou un refus.
//
//   2. Identification. Overpass demande aux clients de s'annoncer par un
//      User-Agent explicite et restreint les requetes anonymes. Or fetch()
//      interdit de definir cet en-tete depuis une page web ; seul un appel
//      serveur le peut.
//
//   3. Quota par adresse IP. Depuis le terrain, l'IP mobile est partagee
//      avec d'autres abonnes et peut deja etre limitee. L'IP du relais est
//      stable et connue.
//
// Le relais essaie les miroirs en sequence et renvoie TOUJOURS du JSON avec
// les en-tetes CORS, y compris en cas d'echec : le client peut donc afficher
// un diagnostic exact au lieu d'un message generique.

const MIROIRS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter'
];

// Overpass identifie les clients par cet en-tete et bride les requetes
// anonymes. Le renseigner est autant une politesse envers un service
// benevole qu'une condition d'acces.
const UA = 'TickS-Terrain/2.7 (recensement accessibilite gares; contact via ticks.fr)';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Deux gares voisines interrogees le meme jour donnent la meme requete :
  // le cache de bord evite de solliciter Overpass deux fois pour rien.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const ql = req.method === 'POST'
    ? (typeof req.body === 'string' ? req.body : req.body?.data)
    : req.query.data;

  if (!ql || typeof ql !== 'string') {
    return res.status(400).json({ erreur: 'parametre data manquant' });
  }
  // Garde-fou : une requete demesuree epuiserait le quota du relais pour
  // tous ses utilisateurs.
  if (ql.length > 8000) {
    return res.status(413).json({ erreur: 'requete trop longue' });
  }

  const echecs = [];
  for (const url of MIROIRS) {
    const hote = new URL(url).hostname;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 55000);
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          'Accept': 'application/json'
        },
        body: 'data=' + encodeURIComponent(ql),
        signal: ctrl.signal
      });
      clearTimeout(t);

      const type = r.headers.get('content-type') || '';
      if (!r.ok) {
        const brut = await r.text().catch(() => '');
        const net = brut.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
        echecs.push({ hote, statut: r.status, message: net || motif(r.status) });
        continue;
      }
      if (!/json/i.test(type)) {
        echecs.push({ hote, statut: r.status, message: 'reponse non-JSON (' + type.split(';')[0] + ')' });
        continue;
      }
      const data = await r.json();
      // Overpass repond 200 avec un champ « remark » quand la requete elle-meme
      // est fautive ou trop lourde. Sans ce test, le client croirait a un
      // resultat vide et chercherait une gare inexistante.
      if (data.remark) {
        echecs.push({ hote, statut: 200, message: String(data.remark).slice(0, 180) });
        continue;
      }
      res.setHeader('X-Overpass-Miroir', hote);
      return res.status(200).json(data);
    } catch (e) {
      echecs.push({
        hote,
        statut: 0,
        message: e.name === 'AbortError' ? 'delai de 55 s depasse' : String(e.message || e)
      });
    }
  }

  // 502 et non 500 : l'echec vient des services amont, pas du relais.
  return res.status(502).json({
    erreur: 'aucun miroir Overpass disponible',
    echecs
  });
}

function motif(code) {
  if (code === 400) return 'requete refusee (syntaxe Overpass)';
  if (code === 406) return 'refus du serveur (identification client)';
  if (code === 429) return 'quota atteint, reessayer dans quelques minutes';
  if (code === 504) return 'delai serveur depasse, reduire le rayon';
  return 'HTTP ' + code;
}
