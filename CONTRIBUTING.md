# Workflow Git — TickS Terrain

## Setup initial (une seule fois)

```bash
git clone https://github.com/jonathanmorel76/Recensement-terrain-access.git
cd Recensement-terrain-access
git config user.name "Jonathan MOREL"
git config user.email "jonathan.morel@ticks.fr"
```

## Workflow quotidien

```bash
git pull                           # 1. Récupérer
# modifier index.html, sw.js...
git add -A                         # 2. Préparer
git commit -m "feat: description"  # 3. Committer
git push                           # 4. Pousser → Vercel redéploie
```

## Convention commits

| Préfixe | Usage |
|---|---|
| `feat:` | Nouvelle fonctionnalité |
| `fix:` | Correction de bug |
| `ui:` | Changement visuel |
| `perf:` | Optimisation |
| `docs:` | Documentation |

## Structure du repo

```
Recensement-terrain-access/
├── index.html       ← PWA complète (HTML + CSS + JS)
├── sw.js            ← Service Worker (cache offline)
├── manifest.json    ← Manifest PWA iOS/Android
├── vercel.json      ← Headers cache Vercel
└── CONTRIBUTING.md  ← Ce fichier
```

## Déploiement

Chaque `git push` sur `main` déclenche un redéploiement automatique sur Vercel (~30s).
