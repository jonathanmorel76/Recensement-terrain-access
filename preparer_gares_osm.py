#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
preparer_gares_osm.py — TickS Terrain

Prepare le catalogue de reference OSM des gares : un fichier JSON par site,
que la PWA charge ensuite sans jamais interroger Overpass.

POURQUOI CE SCRIPT PLUTOT QU'UN APPEL DEPUIS L'APP
--------------------------------------------------
L'app interrogeait Overpass au moment ou l'operateur en avait besoin. Trois
raisons rendent cette approche intenable :

  1. Overpass bloque les plages AWS et Azure depuis octobre 2025, pour se
     proteger d'un usage abusif depuis le cloud. Tout relais deploye sur
     Vercel est donc rejete sans code d'erreur.
  2. L'instance publique est notoirement congestionnee : les mainteneurs
     eux-memes la decrivent comme difficilement utilisable.
  3. Meme si elle repondait, faire dependre un outil de terrain d'un service
     benevole a l'instant precis ou l'on en a besoin est fragile par nature.

Depuis un poste de travail en revanche, Overpass repond — c'est deja ce qui
alimente les traitements QGIS du projet. On y prepare donc les donnees une
fois, tranquillement, avec des reprises sur echec et sans contrainte de
temps. La PWA ne lit plus que des fichiers statiques, servis par le meme
hebergeur qu'elle : plus rapide, disponible hors ligne, et insensible a
l'etat d'Overpass.

Le format de sortie est EXACTEMENT celui qu'osm.js stocke en IndexedDB, pour
que les deux chemins d'alimentation restent interchangeables.

Usage :
    # Modele de liste de gares a completer
    python preparer_gares_osm.py --modele gares.csv

    # Preparation du catalogue
    python preparer_gares_osm.py --gares gares.csv --out ./gares --rayon 500

    # Reprise : seules les gares absentes ou trop anciennes sont retraitees
    python preparer_gares_osm.py --gares gares.csv --out ./gares --reprendre

Puis committer le dossier ./gares a la racine du depot.
"""

import argparse
import csv
import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Instance francaise en tete : la plus proche pour des donnees normandes.
MIROIRS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
]

# Overpass journalise le User-Agent pour distinguer les usages identifies des
# scripts anonymes, qui sont les premiers brides. Le renseigner est autant une
# politesse envers un service benevole qu'une condition d'acces.
UA = 'TickS-Terrain-prep/1.0 (recensement accessibilite gares normandes; contact TickS)'

# Les seuls tags conserves. Le reste (source, import_uuid, check_date...)
# multiplie le volume par trois sans servir au recensement.
TAGS_UTILES = [
    'wheelchair', 'tactile_paving', 'ramp', 'handrail', 'step_count',
    'incline', 'width', 'surface', 'smoothness', 'kerb', 'conveying',
    'automatic_door', 'door', 'name', 'ref', 'level', 'indoor', 'covered',
    'highway', 'railway', 'entrance', 'barrier', 'public_transport',
    'access', 'foot',
]


def sans_accent(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def slugify(s):
    s = sans_accent(s).lower()
    return ''.join(c if c.isalnum() else '-' for c in s).strip('-').replace('--', '-')


def ql_gare(lat, lon, rayon):
    """Reseau pietonnier et noeuds de cheminement UNIQUEMENT.

    Le mobilier et les services (bancs, abris, toilettes, valideurs,
    distributeurs, stationnement velo, points d'appel, panneaux) sont
    volontairement exclus : ils relevent du recensement terrain, ou ils sont
    constates et qualifies. Les reprendre depuis OSM ferait cohabiter deux
    versions du meme objet, l'une observee et l'autre supposee, avec le risque
    qu'un operateur prenne la seconde pour la premiere.

    Les noeuds conserves font partie de la TOPOLOGIE du cheminement : un
    ascenseur est une liaison verticale, une traversee un franchissement, un
    tourniquet une contrainte de passage. Les omettre produirait un graphe
    faux, ou l'on marcherait a travers les murs.
    """
    a = f'around:{rayon},{lat},{lon}'
    # Timeout genereux : contrairement a l'app, on n'est presse par personne
    # et une requete lente reste preferable a une requete abandonnee.
    return f"""[out:json][timeout:180];
(
  way({a})["highway"~"^(footway|path|pedestrian|steps|corridor|living_street)$"];
  way({a})["highway"]["foot"~"^(yes|designated)$"];
  way({a})["railway"="platform"];
  way({a})["public_transport"="platform"];
  node({a})["highway"~"^(elevator|crossing)$"];
  node({a})["railway"~"^(subway_entrance|train_station_entrance)$"];
  node({a})["barrier"~"^(turnstile|kerb|gate)$"];
  node({a})["entrance"];
);
out geom;"""


def overpass(ql, essais=3):
    """Interroge les miroirs en sequence, avec temporisation croissante.

    Un echec sur un miroir n'a rien d'exceptionnel : on ne s'arrete que si
    TOUS ont echoue sur TOUS les essais.
    """
    dernier = None
    for essai in range(1, essais + 1):
        for url in MIROIRS:
            hote = urllib.parse.urlparse(url).hostname
            try:
                req = urllib.request.Request(
                    url,
                    data=urllib.parse.urlencode({'data': ql}).encode(),
                    headers={'User-Agent': UA, 'Accept': 'application/json'})
                with urllib.request.urlopen(req, timeout=200) as r:
                    d = json.loads(r.read().decode('utf-8'))
                if 'remark' in d:
                    dernier = f'{hote} : {d["remark"][:120]}'
                    continue
                return d, hote
            except Exception as e:
                dernier = f'{hote} : {e}'
        if essai < essais:
            # Une temporisation croissante laisse a un quota le temps de se
            # liberer ; reessayer immediatement ne ferait qu'aggraver la charge.
            attente = 20 * essai
            print(f'      tous les miroirs ont echoue, nouvel essai dans {attente} s '
                  f'({dernier})')
            time.sleep(attente)
    raise RuntimeError(dernier or 'echec inconnu')


def compacter(elements):
    lignes, points = [], []
    for el in elements:
        tags = {k: el['tags'][k] for k in TAGS_UTILES
                if el.get('tags') and k in el['tags']}
        if el['type'] == 'way' and el.get('geometry'):
            # 6 decimales = environ 11 cm. Au-dela, on stocke du bruit.
            lignes.append({'i': el['id'], 't': tags,
                           'g': [[round(p['lat'], 6), round(p['lon'], 6)]
                                 for p in el['geometry']]})
        elif el['type'] == 'node' and el.get('lat') is not None:
            points.append({'i': el['id'], 't': tags,
                           'g': [round(el['lat'], 6), round(el['lon'], 6)]})
    return lignes, points


def modele(chemin):
    """Ecrit un CSV d'exemple, pre-rempli de quelques gares normandes.

    Les coordonnees servent de point de depart : les verifier avant lancement,
    un centroide mal place decale tout le rayon d'extraction.
    """
    exemples = [
        ('Rouen Rive-Droite', 49.44935, 1.09470, '87411017', '76540'),
        ('Le Havre', 49.49250, 0.12330, '87413013', '76351'),
        ('Caen', 49.17580, -0.34770, '87444000', '14118'),
        ('Cherbourg', 49.63940, -1.62220, '87444877', '50129'),
        ('Bayeux', 49.27600, -0.70200, '87444216', '14047'),
        ('Pontorson', 48.55370, -1.50480, '87444992', '50410'),
    ]
    with open(chemin, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['nom', 'lat', 'lon', 'uic', 'insee'])
        w.writerows(exemples)
    print(f'Modele ecrit : {chemin}')
    print('Completer la liste, verifier les coordonnees, puis relancer avec --gares.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modele', help='ecrit un CSV modele puis quitte')
    ap.add_argument('--gares', help='CSV : nom;lat;lon;uic;insee')
    ap.add_argument('--out', default='./gares')
    ap.add_argument('--rayon', type=int, default=500)
    ap.add_argument('--reprendre', action='store_true',
                    help='ignore les gares deja extraites il y a moins de 30 jours')
    ap.add_argument('--pause', type=float, default=8.0,
                    help="temporisation entre gares, en secondes. Ne pas descendre "
                         "trop bas : Overpass est un service benevole, et une "
                         "rafale ferait brider l'adresse du poste.")
    a = ap.parse_args()

    if a.modele:
        modele(a.modele)
        return
    if not a.gares:
        ap.error('fournir --gares, ou --modele pour obtenir un CSV d exemple')

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    with open(a.gares, encoding='utf-8-sig') as f:
        gares = list(csv.DictReader(f, delimiter=';'))
    print(f'{len(gares)} gare(s) a traiter, rayon {a.rayon} m\n')

    catalogue, echecs, ignorees = [], [], 0
    for i, g in enumerate(gares, 1):
        nom = g['nom'].strip()
        slug = slugify(nom)
        cible = out / f'{slug}.json'

        if a.reprendre and cible.exists():
            age = (time.time() - cible.stat().st_mtime) / 86400
            if age < 30:
                print(f'[{i}/{len(gares)}] {nom} : deja extrait il y a {age:.0f} j, ignore')
                catalogue.append(json.loads(cible.read_text(encoding='utf-8'))['meta'])
                ignorees += 1
                continue

        print(f'[{i}/{len(gares)}] {nom}\u2026', end=' ', flush=True)
        try:
            d, hote = overpass(ql_gare(float(g['lat']), float(g['lon']), a.rayon))
        except Exception as e:
            print(f'ECHEC\n      {e}')
            echecs.append((nom, str(e)))
            continue

        lignes, points = compacter(d.get('elements', []))
        rec = {
            'slug': slug, 'nom': nom,
            'uic': (g.get('uic') or '').strip() or None,
            'insee': (g.get('insee') or '').strip() or None,
            'lat': float(g['lat']), 'lon': float(g['lon']), 'rayon': a.rayon,
            'lignes': lignes, 'points': points,
            'maj': int(time.time() * 1000),
            'source': f'OpenStreetMap via {hote}',
        }
        texte = json.dumps(rec, ensure_ascii=False, separators=(',', ':'))
        rec['taille'] = len(texte.encode('utf-8'))
        texte = json.dumps(rec, ensure_ascii=False, separators=(',', ':'))
        cible.write_text(texte, encoding='utf-8')

        meta = {k: rec[k] for k in ('slug', 'nom', 'uic', 'insee', 'lat', 'lon',
                                    'rayon', 'maj', 'taille')}
        meta['nb_lignes'] = len(lignes)
        meta['nb_points'] = len(points)
        catalogue.append(meta)
        # On reecrit le fichier avec le bloc meta, pour que --reprendre puisse
        # le relire sans reinterroger Overpass.
        rec['meta'] = meta
        cible.write_text(json.dumps(rec, ensure_ascii=False, separators=(',', ':')),
                         encoding='utf-8')
        print(f'{len(lignes)} cheminements, {len(points)} objets, '
              f'{rec["taille"] // 1024} Ko  [{hote}]')

        if i < len(gares) and not (a.reprendre and cible.exists() and ignorees):
            time.sleep(a.pause)

    # Index consulte par l'app pour lister les gares disponibles.
    index = {
        'genere_le': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'rayon': a.rayon,
        'attribution': '\u00a9 les contributeurs OpenStreetMap (ODbL)',
        'gares': sorted(catalogue, key=lambda x: sans_accent(x['nom']).lower()),
    }
    (out / 'index.json').write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')

    total = sum(g['taille'] for g in catalogue)
    print(f'\n{len(catalogue)} gare(s) au catalogue \u2014 {total // 1024} Ko au total')
    print(f'-> {out}/index.json')
    if echecs:
        print(f'\n{len(echecs)} echec(s), a relancer avec --reprendre :')
        for nom, e in echecs:
            print(f'   {nom} : {e[:110]}')
        sys.exit(1)


if __name__ == '__main__':
    main()
