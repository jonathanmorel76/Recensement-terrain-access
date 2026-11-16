# Kanban MaaS Atoumod

Cet outil lit la boîte mail Outlook et l'agenda Microsoft 365, en retient les tâches
qui concernent le **MaaS Atoumod**, et produit un **Kanban Excel détaillé**.

## Fonctionnement

1. **Extraction** : Claude interroge Outlook (mails et agenda) avec le connecteur Microsoft 365
   et applique les règles ci-dessous. Il en tire un fichier `donnees/taches.json`.
2. **Génération** : `generer_kanban.py` transforme ce JSON en classeur Excel.

```bash
pip install openpyxl
python3 generer_kanban.py donnees/taches.json -o Kanban_MaaS_Atoumod.xlsx
```

## Le classeur

| Onglet | Contenu |
|---|---|
| **Kanban** | 5 colonnes (À faire, Planifié, En cours, En attente (tiers), Terminé). La couleur des cartes suit la priorité. Une carte rouge « ⚠ EN RETARD » signale une échéance dépassée. |
| **Tâches** | La liste de référence, éditable. Statut, priorité et catégorie se choisissent dans des listes déroulantes. Elle contient aussi la colonne J-restants, la prochaine action, la description, l'interlocuteur et un lien vers le mail ou le RDV source. |
| **Tableau de bord** | Tâches ouvertes, tâches en retard, échéances à 7 jours, priorités hautes, répartition par statut et par catégorie. |
| **Agenda** | Les réunions et créneaux MaaS à venir. |
| **Mode d'emploi** | Comment utiliser le classeur. |

Le Kanban est **piloté par formules** (INDEX/MATCH, compatibles avec toutes les versions
d'Excel et avec LibreOffice). Quand on change un statut dans l'onglet « Tâches », la
carte change de colonne dans le Kanban.

## Règles d'extraction

**Sources lues**
- Mails des 30 derniers jours : expéditeurs `@atoumod.fr`, `@normandie.fr`,
  `@instant-system.com`, `@cityway.fr`, `@wop-app.com`, `@fairtiq.com`, l'équipe Ticks,
  les mails envoyés par moi, ceux envoyés à `atoumod-maas@ticks.fr` ou
  `signalement.atoumod-maas@ticks.fr`, et le mot-clé `Atoumod`.
- Agenda des 2 à 3 semaines à venir.

**Ce qui devient une tâche**
- Une demande explicite qui m'est adressée ou adressée à LD Atoumod-MaaS (« pouvez-vous… », « merci de… »).
- Un engagement que j'ai pris dans un mail envoyé (« nous allons… », « je reviens vers toi… »).
- Un créneau « tâche » posé dans l'agenda (catégories *Paramétrages & actions diverses*,
  *Supervision*, ou journée entière).
- Une réunion qui demande une préparation (présentation, démo, atelier).
- Un signalement GRC ou une alerte de jeu de données périmé.

**Ce qui est regroupé ou ignoré**
- Les alertes automatiques `supervision@ticks.fr` sont **regroupées en une seule tâche**
  quand elles se répètent (alternance KO et OK). Le rapport hebdo UP est ignoré.
- Les notifications Redmine, Jira et YouTrack sont regroupées par livraison ou par sujet.
- Les événements annulés, les déjeuners, les accusés de réception et les infos trafic sont ignorés.

**Statuts**
- `Planifié` : un créneau existe dans l'agenda.
- `En attente (tiers)` : la balle est chez un partenaire (WOP, IS, FAIRTIQ…).
- `En cours` : déjà commencé ou promis pour la semaine.

**Priorités**
- `Haute` : supervision, engagement pris envers un client ou un partenaire, échéance de moins de 7 jours, bug de production.
- `Moyenne` : évolutions et préparations.
- `Basse` : suivi seulement.

## Format du JSON

```json
{
  "genere_le": "2026-11-16",
  "periode_analysee": "…",
  "taches": [{
    "id": "T01", "titre": "…", "description": "…", "categorie": "Données GTFS",
    "interlocuteurs": "…", "priorite": "Haute", "statut": "À faire",
    "recurrence": "", "echeance": "2026-11-20", "prochaine_action": "…",
    "source": "Mail", "reference": "Objet du mail", "lien": "https://outlook.office365.com/…"
  }],
  "agenda": [{"debut": "2026-11-16 08:00", "fin": "2026-11-16 12:00",
              "titre": "…", "organisateur": "…", "statut": "Accepté"}]
}
```

Le dossier `donnees/` et les fichiers `.xlsx` générés contiennent des extraits de mails.
Ils sont exclus de git (voir `.gitignore`).
