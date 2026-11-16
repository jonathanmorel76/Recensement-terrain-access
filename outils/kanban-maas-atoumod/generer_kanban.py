#!/usr/bin/env python3
"""Génère un Kanban Excel détaillé des tâches MaaS Atoumod.

Entrée  : un fichier JSON (voir donnees/taches.json et README.md pour le format)
Sortie  : un classeur .xlsx avec les onglets
          - Kanban          : colonnes par statut, alimentées par formules
          - Tâches          : liste détaillée et éditable (statut, priorité, échéance…)
          - Tableau de bord : compteurs (retards, priorités, catégories)
          - Agenda          : réunions et créneaux à venir
          - Mode d'emploi

Le Kanban est piloté par l'onglet « Tâches » : changer le statut d'une tâche
la déplace automatiquement dans la bonne colonne (formules INDEX/MATCH,
compatibles avec toutes les versions d'Excel et LibreOffice).

Usage : python3 generer_kanban.py donnees/taches.json -o Kanban_MaaS_Atoumod.xlsx
"""

import argparse
import json
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

STATUTS = ["À faire", "Planifié", "En cours", "En attente (tiers)", "Terminé"]
COULEUR_STATUT = {
    "À faire": "5B6B7F",
    "Planifié": "2F6FB2",
    "En cours": "C77700",
    "En attente (tiers)": "7A4FA3",
    "Terminé": "2E7D4F",
}
PRIORITES = ["Haute", "Moyenne", "Basse"]
ORDRE_PRIORITE = {p: i for i, p in enumerate(PRIORITES)}
CATEGORIES = [
    "Supervision", "Données GTFS", "Paramétrage", "Billettique & Vente",
    "Recette & Tests", "Outillage", "Relation partenaires", "Documentation",
]

MAX_TACHES = 500          # lignes couvertes par les formules
LIGNES_KANBAN = 40        # cartes affichables par colonne

BLEU_NUIT = "1F2A44"
GRIS_CLAIR = "F3F5F8"
FIN = Side(style="thin", color="D0D5DD")
BORDURE = Border(left=FIN, right=FIN, top=FIN, bottom=FIN)


def fill(hex_color):
    return PatternFill("solid", start_color=hex_color, end_color=hex_color)


def en_tete(cell, couleur=BLEU_NUIT):
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = fill(couleur)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = BORDURE


def parse_date(valeur):
    if not valeur:
        return None
    return datetime.strptime(valeur[:10], "%Y-%m-%d").date()


# --------------------------------------------------------------------------- #
# Onglet Tâches
# --------------------------------------------------------------------------- #
COLONNES_TACHES = [
    # (clé JSON, en-tête, largeur)
    ("id", "ID", 6),
    ("titre", "Tâche", 48),
    ("statut", "Statut", 17),
    ("priorite", "Priorité", 10),
    ("echeance", "Échéance", 11),
    (None, "J-restants", 10),
    ("categorie", "Catégorie", 18),
    ("interlocuteurs", "Interlocuteurs", 28),
    ("prochaine_action", "Prochaine action", 45),
    ("description", "Description détaillée", 70),
    ("recurrence", "Récurrence", 18),
    ("source", "Source", 8),
    ("reference", "Référence (objet du mail / RDV)", 45),
    ("lien", "Lien Outlook", 12),
]
COL = {entete: get_column_letter(i + 1) for i, (_, entete, _) in enumerate(COLONNES_TACHES)}
COL_CARTE = get_column_letter(len(COLONNES_TACHES) + 2)          # colonne cachée
COLS_RANG = [get_column_letter(len(COLONNES_TACHES) + 3 + i) for i in range(len(STATUTS))]


def onglet_taches(wb, taches):
    ws = wb.create_sheet("Tâches")
    n = len(COLONNES_TACHES)
    for i, (_, entete, largeur) in enumerate(COLONNES_TACHES, start=1):
        en_tete(ws.cell(row=1, column=i, value=entete))
        ws.column_dimensions[get_column_letter(i)].width = largeur
    ws.row_dimensions[1].height = 30

    c_stat, c_prio, c_ech, c_cat = COL["Statut"], COL["Priorité"], COL["Échéance"], COL["Catégorie"]

    for r, t in enumerate(taches, start=2):
        for i, (cle, entete, _) in enumerate(COLONNES_TACHES, start=1):
            cell = ws.cell(row=r, column=i)
            if entete == "J-restants":
                cell.value = (f'=IF(OR({c_stat}{r}="Terminé",{c_ech}{r}=""),"",'
                              f'{c_ech}{r}-TODAY())')
                cell.number_format = "0"
            elif cle == "echeance":
                cell.value = parse_date(t.get(cle))
                cell.number_format = "DD/MM/YYYY"
            elif cle == "lien":
                if t.get("lien"):
                    cell.value = "Ouvrir ↗"
                    cell.hyperlink = t["lien"]
                    cell.font = Font(color="1F5FBF", underline="single")
            else:
                cell.value = t.get(cle, "")
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDURE
        ws.cell(row=r, column=1).font = Font(bold=True)

    # --- colonnes techniques (cachées) qui alimentent le Kanban ------------- #
    ws[f"{COL_CARTE}1"] = "Carte (technique)"
    for j, statut in enumerate(STATUTS):
        ws[f"{COLS_RANG[j]}1"] = statut
    for r in range(2, MAX_TACHES + 2):
        a, b = f"{COL['ID']}{r}", f"{COL['Tâche']}{r}"
        s, p, e, g = f"{c_stat}{r}", f"{c_prio}{r}", f"{c_ech}{r}", f"{c_cat}{r}"
        jjmm = f'RIGHT("0"&DAY({e}),2)&"/"&RIGHT("0"&MONTH({e}),2)'
        ws[f"{COL_CARTE}{r}"] = (
            f'=IF({a}="","",'
            f'IF(AND({s}<>"Terminé",{e}<>"",{e}<TODAY()),"⚠ EN RETARD · ","")'
            f'&{a}&" · "&{b}&CHAR(10)&'
            f'IF({e}="","",{jjmm}&"  •  ")&"Priorité "&{p}&"  •  "&{g})'
        )
        for j in range(len(STATUTS)):
            col = COLS_RANG[j]
            ws[f"{col}{r}"] = (f'=IF({s}={col}$1,COUNTIF({c_stat}$2:{s},{col}$1),"")')
    for col in [COL_CARTE] + COLS_RANG:
        ws.column_dimensions[col].hidden = True

    # --- listes déroulantes ------------------------------------------------- #
    plage = lambda c: f"{c}2:{c}{MAX_TACHES + 1}"
    for col, valeurs in ((c_stat, STATUTS), (c_prio, PRIORITES), (c_cat, CATEGORIES)):
        dv = DataValidation(type="list", formula1='"' + ",".join(valeurs) + '"', allow_blank=True)
        dv.add(plage(col))
        ws.add_data_validation(dv)

    # --- mises en forme conditionnelles ------------------------------------- #
    zone = f"A2:{get_column_letter(n)}{MAX_TACHES + 1}"
    ws.conditional_formatting.add(zone, FormulaRule(
        formula=[f'${c_stat}2="Terminé"'], font=Font(color="8A8F98", strike=True), fill=fill("EEF6F0")))
    ws.conditional_formatting.add(zone, FormulaRule(
        formula=[f'AND(${c_stat}2<>"Terminé",${c_ech}2<>"",${c_ech}2<TODAY())'], fill=fill("FDE2E1")))
    for prio, coul in (("Haute", "C62828"), ("Moyenne", "B26A00"), ("Basse", "2E7D32")):
        ws.conditional_formatting.add(plage(c_prio), FormulaRule(
            formula=[f'{c_prio}2="{prio}"'], font=Font(bold=True, color=coul)))
    for statut, coul in COULEUR_STATUT.items():
        ws.conditional_formatting.add(plage(c_stat), FormulaRule(
            formula=[f'{c_stat}2="{statut}"'], font=Font(bold=True, color="FFFFFF"), fill=fill(coul)))

    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(n)}{len(taches) + 1}"
    return ws


# --------------------------------------------------------------------------- #
# Onglet Kanban
# --------------------------------------------------------------------------- #
def onglet_kanban(wb, meta):
    ws = wb.create_sheet("Kanban", 0)
    ws.sheet_view.showGridLines = False
    nb = len(STATUTS)
    derniere = get_column_letter(nb)

    ws.merge_cells(f"A1:{derniere}1")
    ws["A1"] = "Kanban MaaS Atoumod : tâches extraites des mails et de l'agenda"
    ws["A1"].font = Font(bold=True, size=16, color="FFFFFF")
    ws["A1"].fill = fill(BLEU_NUIT)
    ws["A1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 34

    ws.merge_cells(f"A2:{derniere}2")
    ws["A2"] = (f"Généré le {meta['genere_le_fr']} · {meta.get('periode_analysee', '')} · "
                "Change le statut dans l'onglet « Tâches » pour déplacer une carte.")
    ws["A2"].font = Font(italic=True, color="5B6B7F")
    ws["A2"].alignment = Alignment(indent=1)

    c_stat = COL["Statut"]
    for j, statut in enumerate(STATUTS):
        col = get_column_letter(j + 1)
        ws.column_dimensions[col].width = 44
        cell = ws[f"{col}3"]
        cell.value = (f'="{statut.upper()}  ("&COUNTIF(\'Tâches\'!${c_stat}$2:${c_stat}${MAX_TACHES + 1},'
                      f'"{statut}")&")"')
        en_tete(cell, COULEUR_STATUT[statut])
        ws.row_dimensions[3].height = 28
        for k in range(1, LIGNES_KANBAN + 1):
            r = 3 + k
            c = ws[f"{col}{r}"]
            c.value = (f"=IFERROR(INDEX('Tâches'!${COL_CARTE}$2:${COL_CARTE}${MAX_TACHES + 1},"
                       f"MATCH({k},'Tâches'!${COLS_RANG[j]}$2:${COLS_RANG[j]}${MAX_TACHES + 1},0)),\"\")")
            c.alignment = Alignment(wrap_text=True, vertical="top")
            c.fill = fill(GRIS_CLAIR)
    for k in range(1, LIGNES_KANBAN + 1):
        ws.row_dimensions[3 + k].height = 48

    zone = f"A4:{derniere}{3 + LIGNES_KANBAN}"
    blanc = Side(style="medium", color="FFFFFF")
    ws.conditional_formatting.add(zone, FormulaRule(
        formula=['ISNUMBER(SEARCH("EN RETARD",A4))'],
        font=Font(bold=True, color="9B1C1C"), fill=fill("F8C9C6"),
        border=Border(left=Side(style="thick", color="C62828"), top=blanc, bottom=blanc), stopIfTrue=True))
    for prio, fond, liseré in (("Haute", "FDE7E5", "E57373"),
                               ("Moyenne", "FFF4DC", "F0B44C"),
                               ("Basse", "E7F4EA", "66BB6A")):
        ws.conditional_formatting.add(zone, FormulaRule(
            formula=[f'ISNUMBER(SEARCH("Priorité {prio}",A4))'], fill=fill(fond),
            border=Border(left=Side(style="thick", color=liseré), top=blanc, bottom=blanc), stopIfTrue=True))
    ws.freeze_panes = "A4"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws


# --------------------------------------------------------------------------- #
# Onglet Tableau de bord
# --------------------------------------------------------------------------- #
def onglet_tableau_de_bord(wb):
    ws = wb.create_sheet("Tableau de bord", 1)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["D"].width = 26
    ws.column_dimensions["E"].width = 12

    t = lambda c: f"'Tâches'!${c}$2:${c}${MAX_TACHES + 1}"
    S, P, E, G = t(COL["Statut"]), t(COL["Priorité"]), t(COL["Échéance"]), t(COL["Catégorie"])

    ws.merge_cells("A1:E1")
    ws["A1"] = "Tableau de bord"
    ws["A1"].font = Font(bold=True, size=16, color="FFFFFF")
    ws["A1"].fill = fill(BLEU_NUIT)
    ws.row_dimensions[1].height = 30

    kpis = [
        ("Tâches ouvertes", f'=COUNTA({S})-COUNTIF({S},"Terminé")', "2F6FB2"),
        ("⚠ En retard", f'=COUNTIFS({E},"<"&TODAY(),{S},"<>Terminé")', "C62828"),
        ("Échéance ≤ 7 jours", f'=COUNTIFS({E},">="&TODAY(),{E},"<="&TODAY()+7,{S},"<>Terminé")', "C77700"),
        ("Priorité haute ouvertes", f'=COUNTIFS({P},"Haute",{S},"<>Terminé")', "7A4FA3"),
    ]
    r = 3
    for libelle, formule, coul in kpis:
        ws[f"A{r}"] = libelle
        ws[f"A{r}"].font = Font(bold=True)
        ws[f"B{r}"] = formule
        ws[f"B{r}"].font = Font(bold=True, size=14, color="FFFFFF")
        ws[f"B{r}"].fill = fill(coul)
        ws[f"B{r}"].alignment = Alignment(horizontal="center")
        r += 1

    r += 1
    en_tete(ws[f"A{r}"]); ws[f"A{r}"] = "Statut"
    en_tete(ws[f"B{r}"]); ws[f"B{r}"] = "Nb"
    en_tete(ws[f"D{r}"]); ws[f"D{r}"] = "Catégorie (ouvertes)"
    en_tete(ws[f"E{r}"]); ws[f"E{r}"] = "Nb"
    debut = r + 1
    for i, statut in enumerate(STATUTS):
        ws[f"A{debut + i}"] = statut
        ws[f"B{debut + i}"] = f'=COUNTIF({S},A{debut + i})'
    for i, cat in enumerate(CATEGORIES):
        ws[f"D{debut + i}"] = cat
        ws[f"E{debut + i}"] = f'=COUNTIFS({G},D{debut + i},{S},"<>Terminé")'
    for row in ws.iter_rows(min_row=debut, max_row=debut + max(len(STATUTS), len(CATEGORIES)) - 1,
                            max_col=5):
        for c in row:
            if c.column != 3:
                c.border = BORDURE
    return ws


# --------------------------------------------------------------------------- #
# Onglet Agenda
# --------------------------------------------------------------------------- #
def onglet_agenda(wb, agenda):
    ws = wb.create_sheet("Agenda")
    entetes = [("Début", 18), ("Fin", 18), ("Réunion / créneau", 55), ("Organisateur", 22), ("Ma réponse", 14)]
    for i, (h, w) in enumerate(entetes, start=1):
        en_tete(ws.cell(row=1, column=i, value=h))
        ws.column_dimensions[get_column_letter(i)].width = w
    for r, ev in enumerate(sorted(agenda, key=lambda e: e["debut"]), start=2):
        valeurs = [datetime.strptime(ev["debut"], "%Y-%m-%d %H:%M"),
                   datetime.strptime(ev["fin"], "%Y-%m-%d %H:%M"),
                   ev["titre"], ev.get("organisateur", ""), ev.get("statut", "")]
        for i, v in enumerate(valeurs, start=1):
            c = ws.cell(row=r, column=i, value=v)
            c.border = BORDURE
            if i <= 2:
                c.number_format = "ddd DD/MM HH:MM"
        if r % 2 == 0:
            for i in range(1, 6):
                ws.cell(row=r, column=i).fill = fill(GRIS_CLAIR)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:E{len(agenda) + 1}"
    return ws


def onglet_mode_emploi(wb):
    ws = wb.create_sheet("Mode d'emploi")
    ws.column_dimensions["A"].width = 120
    lignes = [
        ("Mode d'emploi", True),
        ("1. L'onglet « Tâches » sert de référence : modifie ici le statut, la priorité ou l'échéance avec les listes déroulantes.", False),
        ("2. L'onglet « Kanban » se met à jour tout seul (formules). Une carte rouge « ⚠ EN RETARD » signale une échéance dépassée.", False),
        ("3. Pour ajouter une tâche à la main, remplis une nouvelle ligne dans « Tâches » (ID, Tâche, Statut, Priorité, Échéance, Catégorie).", False),
        ("4. Le lien « Ouvrir ↗ » ouvre le mail ou le rendez-vous source dans Outlook Web.", False),
        ("5. Statuts : À faire → Planifié (créneau posé dans l'agenda) → En cours → En attente (tiers) → Terminé.", False),
        ("", False),
        ("Régénérer le fichier", True),
        ("Les tâches sont extraites de la boîte Outlook et de l'agenda selon les règles décrites dans outils/kanban-maas-atoumod/README.md,", False),
        ("puis le classeur est produit par : python3 generer_kanban.py donnees/taches.json -o Kanban_MaaS_Atoumod.xlsx", False),
    ]
    for r, (texte, titre) in enumerate(lignes, start=1):
        c = ws.cell(row=r, column=1, value=texte)
        c.alignment = Alignment(wrap_text=True)
        if titre:
            c.font = Font(bold=True, size=13, color=BLEU_NUIT)
    return ws


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json", type=Path, help="fichier JSON des tâches")
    ap.add_argument("-o", "--sortie", type=Path, default=None, help="fichier .xlsx de sortie")
    args = ap.parse_args()

    data = json.loads(args.json.read_text(encoding="utf-8"))
    genere_le = parse_date(data.get("genere_le")) or date.today()
    meta = {
        "genere_le_fr": genere_le.strftime("%d/%m/%Y"),
        "periode_analysee": data.get("periode_analysee", ""),
    }

    taches = sorted(
        data["taches"],
        key=lambda t: (t.get("statut") == "Terminé",
                       ORDRE_PRIORITE.get(t.get("priorite"), 9),
                       t.get("echeance") or "9999"),
    )
    for t in taches:
        if t.get("statut") not in STATUTS:
            raise SystemExit(f"Statut inconnu pour {t.get('id')} : {t.get('statut')!r} (attendu : {STATUTS})")

    wb = Workbook()
    wb.remove(wb.active)
    onglet_taches(wb, taches)
    onglet_kanban(wb, meta)
    onglet_tableau_de_bord(wb)
    onglet_agenda(wb, data.get("agenda", []))
    onglet_mode_emploi(wb)
    wb.active = 0

    sortie = args.sortie or args.json.parent / f"Kanban_MaaS_Atoumod_{genere_le.isoformat()}.xlsx"
    wb.save(sortie)
    print(f"Classeur généré : {sortie}  ({len(taches)} tâches, {len(data.get('agenda', []))} RDV)")


if __name__ == "__main__":
    main()
