Attribute VB_Name = "KanbanOutlook"
'==============================================================================
' Kanban MaaS Atoumod - actualisation depuis Outlook (sans Claude)
'
' Lit Outlook classique sur le poste (boîte de réception, éléments envoyés,
' agenda) et met à jour les onglets « Tâches » et « Agenda » du classeur.
' Le Kanban se recalcule ensuite tout seul (formules).
'
' Macros disponibles (Alt+F8) :
'   ActualiserKanban      : lance l'actualisation
'   OuvrirSource          : ouvre dans Outlook le mail / RDV de la ligne sélectionnée
'   InstallerBoutons      : ajoute les boutons sur l'onglet Kanban (à lancer une fois)
'
' Les réglages (mots-clés, domaines, nb de jours...) sont dans l'onglet « Paramètres ».
' Les statuts / priorités modifiés à la main ne sont jamais écrasés, sauf
' passage automatique en « Terminé » quand le drapeau Outlook est marqué terminé.
'
' Prérequis : Outlook « classique » (le nouvel Outlook ne permet pas les macros).
' Aucune référence VBA à cocher (liaison tardive).
'==============================================================================
Option Explicit

' --- constantes Outlook (liaison tardive) ---
Private Const olFolderInbox As Long = 6
Private Const olFolderSentMail As Long = 5
Private Const olFolderCalendar As Long = 9
Private Const olMail As Long = 43
Private Const olFlagComplete As Long = 1
Private Const olFlagMarked As Long = 2
Private Const olImportanceHigh As Long = 2
Private Const olMeetingCanceled As Long = 5
Private Const olMeetingReceivedAndCanceled As Long = 7

' --- colonnes de l'onglet Tâches ---
Private Const C_ID As Long = 1
Private Const C_TITRE As Long = 2
Private Const C_STATUT As Long = 3
Private Const C_PRIO As Long = 4
Private Const C_ECH As Long = 5
Private Const C_JREST As Long = 6
Private Const C_CAT As Long = 7
Private Const C_INTER As Long = 8
Private Const C_ACTION As Long = 9
Private Const C_DESC As Long = 10
Private Const C_RECUR As Long = 11
Private Const C_SOURCE As Long = 12
Private Const C_REF As Long = 13
Private Const C_LIEN As Long = 14
Private Const C_CLE As Long = 15
Private Const C_EID As Long = 16          ' identifiant Outlook (EntryID), colonne masquée

Private wsT As Object            ' onglet Tâches
Private wsP As Object            ' onglet Paramètres
Private olApp As Object
Private olNs As Object
Private monAdresse As String
Private nbAjouts As Long, nbMaj As Long, nbTermines As Long

'==============================================================================
' POINT D'ENTRÉE
'==============================================================================
Public Sub ActualiserKanban()
    Dim t0 As Double: t0 = Timer
    nbAjouts = 0: nbMaj = 0: nbTermines = 0

    Set wsT = ThisWorkbook.Worksheets("Tâches")
    Set wsP = ThisWorkbook.Worksheets("Paramètres")

    On Error Resume Next
    Set olApp = GetObject(, "Outlook.Application")
    If olApp Is Nothing Then Set olApp = CreateObject("Outlook.Application")
    On Error GoTo Erreur
    If olApp Is Nothing Then
        MsgBox "Impossible de joindre Outlook. Ouvre Outlook (version classique) puis relance.", vbExclamation
        Exit Sub
    End If
    Set olNs = olApp.GetNamespace("MAPI")
    monAdresse = LCase$(AdresseUtilisateur())

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.StatusBar = "Kanban : lecture de l'agenda..."

    TraiterAgenda
    Application.StatusBar = "Kanban : lecture des mails reçus..."
    TraiterMailsRecus
    Application.StatusBar = "Kanban : lecture des mails envoyés..."
    TraiterMailsEnvoyes
    Application.StatusBar = "Kanban : vérification des drapeaux terminés..."
    VerifierDrapeauxTermines

    Horodater

Fin:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Application.StatusBar = False
    MsgBox "Kanban actualisé en " & Format(Timer - t0, "0") & " s" & vbCrLf & vbCrLf & _
           nbAjouts & " nouvelle(s) tâche(s)" & vbCrLf & _
           nbMaj & " tâche(s) déjà présente(s), vérifiée(s)" & vbCrLf & _
           nbTermines & " tâche(s) passée(s) en Terminé", vbInformation, "Kanban MaaS Atoumod"
    Exit Sub
Erreur:
    MsgBox "Erreur pendant l'actualisation : " & Err.Description, vbCritical
    Resume Fin
End Sub

'==============================================================================
' AGENDA
'==============================================================================
Private Sub TraiterAgenda()
    Dim cal As Object, items As Object, it As Object
    Dim dDeb As Date, dFin As Date, filtre As String
    Dim wsA As Object, rA As Long

    dDeb = Date
    dFin = Date + CLng(Param("Jours d'agenda analysés", 21)) + 1
    Set cal = olNs.GetDefaultFolder(olFolderCalendar)
    Set items = cal.Items
    items.Sort "[Start]"
    items.IncludeRecurrences = True
    filtre = "[Start] >= '" & Format(dDeb, "ddddd hh:nn") & "' AND [Start] < '" & Format(dFin, "ddddd hh:nn") & "'"
    Set items = items.Restrict(filtre)

    Set wsA = ThisWorkbook.Worksheets("Agenda")
    wsA.Range("A2:E1000").ClearContents
    rA = 2

    Dim vus As Object: Set vus = CreateObject("Scripting.Dictionary")

    For Each it In items
        TraiterUnRdv it, wsA, rA, vus
    Next it
End Sub

Private Sub TraiterUnRdv(it As Object, wsA As Object, ByRef rA As Long, vus As Object)
    Dim sujet As String, cle As String, estTache As Boolean
    On Error GoTo Sortie
    sujet = it.Subject
    If it.MeetingStatus = olMeetingCanceled Or it.MeetingStatus = olMeetingReceivedAndCanceled Then Exit Sub
    If ContientUn(sujet, Param("Sujets d'agenda ignorés", "")) Then Exit Sub
    If Not RdvPertinent(it) Then Exit Sub

    ' --- onglet Agenda (tous les RDV MaaS) ---
    wsA.Cells(rA, 1).Value = it.Start
    wsA.Cells(rA, 2).Value = it.End
    wsA.Cells(rA, 3).Value = sujet
    wsA.Cells(rA, 4).Value = it.Organizer
    wsA.Cells(rA, 5).Value = IIf(it.IsRecurring, "Récurrent", "")
    rA = rA + 1

    ' --- onglet Tâches : seulement les créneaux « tâche » ---
    estTache = it.AllDayEvent _
               Or ContientUn(it.Categories, Param("Catégories d'agenda = tâche", "")) _
               Or (LCase$(AdresseOrganisateur(it)) = monAdresse And it.Recipients.Count <= 1)
    If Not estTache Then Exit Sub

    If it.IsRecurring Then
        cle = "CALR|" & sujet                     ' une seule ligne par série
    Else
        cle = "CAL|" & it.GlobalAppointmentID
    End If
    If vus.Exists(cle) Then Exit Sub             ' 1re occurrence = prochaine échéance
    vus.Add cle, True

    EcrireTache cle, sujet, "Planifié", PrioriteDefaut(it.Start, False), DateValue(it.Start), _
                CategorieDe(sujet & " " & it.Categories), it.Organizer, _
                "Créneau du " & Format(it.Start, "ddd dd/mm hh:nn"), _
                NettoyerTexte(it.Body, 400), IIf(it.IsRecurring, "Récurrent", ""), _
                "Agenda", sujet, it.EntryID
Sortie:
End Sub

Private Function RdvPertinent(it As Object) As Boolean
    Dim txt As String
    On Error Resume Next
    txt = it.Subject & " " & it.Categories & " " & it.Location & " " & it.RequiredAttendees & " " & it.OptionalAttendees
    On Error GoTo 0
    RdvPertinent = ContientUn(txt, Param("Mots-clés MaaS", "")) _
                   Or ContientUn(txt, Param("Expéditeurs / listes suivis", "")) _
                   Or ContientUn(it.Categories, Param("Catégories d'agenda = tâche", ""))
End Function

'==============================================================================
' MAILS REÇUS
'==============================================================================
Private Sub TraiterMailsRecus()
    Dim inbox As Object
    Set inbox = olNs.GetDefaultFolder(olFolderInbox)
    Dim nbAlertes As Long, derniereAlerte As Date, detailAlertes As String
    ParcourirDossierRecus inbox, nbAlertes, derniereAlerte, detailAlertes, _
                          (LCase$(Param("Inclure les sous-dossiers de la boîte de réception", "Oui")) = "oui")

    ' Une seule tâche hebdomadaire pour les alertes de supervision
    If nbAlertes > 0 Then
        Dim cle As String
        cle = "SUPERVISION|" & Format(Date, "yyyy") & "-S" & Format(DatePart("ww", Date, vbMonday, vbFirstFourDays), "00")
        EcrireTache cle, "Analyser les alertes de supervision (" & nbAlertes & " alertes KO/anomalie)", _
                    "À faire", IIf(nbAlertes >= 5, "Haute", "Moyenne"), Date, "Supervision", _
                    Param("Expéditeur des alertes de supervision", ""), _
                    "Vérifier la cause ou ajuster les seuils", _
                    "Dernière alerte : " & Format(derniereAlerte, "dd/mm hh:nn") & vbLf & Left$(detailAlertes, 600), _
                    "", "Mail", "Alertes supervision automatiques", ""
    End If
End Sub

Private Sub ParcourirDossierRecus(dossier As Object, ByRef nbAlertes As Long, ByRef derniereAlerte As Date, _
                                  ByRef detailAlertes As String, sousDossiers As Boolean)
    Dim items As Object, it As Object, sd As Object
    Dim dDeb As Date, alerteExp As String, catMaaS As String

    dDeb = Date - CLng(Param("Jours de mails analysés", 14))
    alerteExp = LCase$(Param("Expéditeur des alertes de supervision", ""))
    catMaaS = Param("Catégorie Outlook des mails à suivre", "MaaS")

    ' 1) mails avec drapeau : quelle que soit leur date
    On Error Resume Next
    Set items = dossier.Items.Restrict("[FlagStatus] = " & olFlagMarked)
    On Error GoTo 0
    If Not items Is Nothing Then
        For Each it In items
            TraiterMailRecu it, True, catMaaS
        Next it
    End If

    ' 2) mails récents
    Set items = Nothing
    On Error Resume Next
    Set items = dossier.Items.Restrict("[ReceivedTime] >= '" & Format(dDeb, "ddddd hh:nn") & "'")
    On Error GoTo 0
    If Not items Is Nothing Then
        For Each it In items
            TraiterUnMailRecent it, alerteExp, catMaaS, nbAlertes, derniereAlerte, detailAlertes
        Next it
    End If

    If sousDossiers Then
        For Each sd In dossier.Folders
            ParcourirDossierRecus sd, nbAlertes, derniereAlerte, detailAlertes, True
        Next sd
    End If
End Sub

Private Sub TraiterUnMailRecent(it As Object, alerteExp As String, catMaaS As String, ByRef nbAlertes As Long, _
                                ByRef derniereAlerte As Date, ByRef detailAlertes As String)
    Dim expediteur As String, sujet As String
    On Error GoTo Sortie
    If it.Class <> olMail Then Exit Sub
    expediteur = LCase$(AdresseExpediteur(it))
    sujet = it.Subject
    If alerteExp <> "" And expediteur = alerteExp Then
        If ContientUn(sujet, "KO;anomalie;indisponible;erreur;CRITICAL") Then
            nbAlertes = nbAlertes + 1
            If it.ReceivedTime > derniereAlerte Then derniereAlerte = it.ReceivedTime
            If InStr(detailAlertes, Left$(sujet, 50)) = 0 Then detailAlertes = detailAlertes & "• " & sujet & vbLf
        End If
        Exit Sub
    End If
    If it.FlagStatus = olFlagMarked Then Exit Sub    ' déjà traité via les drapeaux
    TraiterMailRecu it, False, catMaaS
Sortie:
End Sub

Private Sub TraiterMailRecu(it As Object, aDrapeau As Boolean, catMaaS As String)
    Dim sujet As String, corps As String, expediteur As String
    Dim estCategorie As Boolean, estDemande As Boolean
    Dim ech As Date, prio As String, cle As String, action As String

    On Error GoTo Sortie
    If it.Class <> olMail Then Exit Sub
    sujet = it.Subject
    expediteur = LCase$(AdresseExpediteur(it))
    corps = Left$(it.Body, 3000)
    estCategorie = ContientUn(it.Categories, catMaaS)

    If expediteur = monAdresse Then Exit Sub

    If Not aDrapeau And Not estCategorie Then
        ' détection automatique d'une demande
        If LCase$(Param("Détecter automatiquement les demandes", "Oui")) <> "oui" Then Exit Sub
        If Not ContientUn(expediteur, Param("Expéditeurs / listes suivis", "")) Then Exit Sub
        If Not ContientUn(sujet & " " & corps, Param("Mots-clés MaaS", "")) _
           And Not ContientUn(expediteur, "@atoumod.fr;@normandie.fr") Then Exit Sub
        If Not ContientUn(PremierMessage(corps), Param("Formules de demande", "")) Then Exit Sub
        If ContientUn(sujet, "Accepté;Acceptée;Refusé;Annulé;Réponse automatique;Automatic reply") Then Exit Sub
    End If

    ' échéance
    ech = DateValue(it.ReceivedTime) + 7
    If aDrapeau Then
        If Year(it.TaskDueDate) < 4000 Then ech = DateValue(it.TaskDueDate)
    End If
    prio = PrioriteDefaut(ech, (it.Importance = olImportanceHigh))

    If aDrapeau Then
        action = "Traiter le mail (drapeau Outlook)"
    ElseIf estCategorie Then
        action = "Traiter le mail (catégorie " & catMaaS & ")"
    Else
        action = "Demande détectée automatiquement : à valider"
    End If

    cle = "CONV|" & it.ConversationID
    EcrireTache cle, NettoyerSujet(sujet), "À faire", prio, ech, CategorieDe(sujet & " " & corps), _
                it.SenderName, action, NettoyerTexte(PremierMessage(corps), 500), "", "Mail", _
                sujet & " (" & Format(it.ReceivedTime, "dd/mm") & ")", it.EntryID
Sortie:
End Sub

'==============================================================================
' MAILS ENVOYÉS : engagements pris
'==============================================================================
Private Sub TraiterMailsEnvoyes()
    Dim items As Object, it As Object, dDeb As Date
    dDeb = Date - CLng(Param("Jours de mails analysés", 14))
    Set items = olNs.GetDefaultFolder(olFolderSentMail).Items.Restrict( _
                "[SentOn] >= '" & Format(dDeb, "ddddd hh:nn") & "'")
    For Each it In items
        TraiterUnMailEnvoye it
    Next it
End Sub

Private Sub TraiterUnMailEnvoye(it As Object)
    Dim corps As String, phrase As String
    On Error GoTo Sortie
    If it.Class <> olMail Then Exit Sub
    corps = PremierMessage(Left$(it.Body, 3000))
    If Not ContientUn(it.Subject & " " & it.To & " " & it.CC & " " & corps, _
                      Param("Mots-clés MaaS", "") & ";" & Param("Expéditeurs / listes suivis", "")) Then Exit Sub
    phrase = PhraseContenant(corps, Param("Formules d'engagement (mails envoyés)", ""))
    If phrase = "" Then Exit Sub

    EcrireTache "CONV|" & it.ConversationID, NettoyerSujet(it.Subject), "À faire", _
                PrioriteDefaut(DateValue(it.SentOn) + 7, True), DateValue(it.SentOn) + 7, _
                CategorieDe(it.Subject & " " & corps), it.To, _
                "Engagement pris le " & Format(it.SentOn, "dd/mm") & " : " & Left$(phrase, 200), _
                NettoyerTexte(corps, 500), "", "Mail", _
                it.Subject & " (envoyé " & Format(it.SentOn, "dd/mm") & ")", it.EntryID
Sortie:
End Sub

'==============================================================================
' Drapeaux marqués « terminé » dans Outlook -> statut Terminé
'==============================================================================
Private Sub VerifierDrapeauxTermines()
    Dim r As Long, derniere As Long, it As Object, id As String
    derniere = DerniereLigne()
    For r = 2 To derniere
        If wsT.Cells(r, C_SOURCE).Value = "Mail" And wsT.Cells(r, C_STATUT).Value <> "Terminé" Then
            id = CStr(wsT.Cells(r, C_EID).Value)
            If Len(id) > 20 Then
                Set it = Nothing
                On Error Resume Next
                Set it = olNs.GetItemFromID(id)
                On Error GoTo 0
                If Not it Is Nothing Then
                    If it.FlagStatus = olFlagComplete Then
                        wsT.Cells(r, C_STATUT).Value = "Terminé"
                        nbTermines = nbTermines + 1
                    End If
                End If
            End If
        End If
    Next r
End Sub

'==============================================================================
' ÉCRITURE D'UNE LIGNE (création ou mise à jour)
'==============================================================================
Private Sub EcrireTache(cle As String, titre As String, statut As String, prio As String, ech As Date, _
                        categorie As String, interlocuteurs As String, action As String, _
                        description As String, recurrence As String, source As String, _
                        reference As String, entryId As String)
    Dim r As Long
    r = TrouverLigne(cle, titre, reference)

    If r = 0 Then
        r = DerniereLigne() + 1
        wsT.Cells(r, C_ID).Value = NouvelId()
        wsT.Cells(r, C_TITRE).Value = titre
        wsT.Cells(r, C_STATUT).Value = statut
        wsT.Cells(r, C_PRIO).Value = prio
        wsT.Cells(r, C_ECH).Value = ech
        wsT.Cells(r, C_JREST).Formula = "=IF(OR(C" & r & "=""Terminé"",E" & r & "=""""),"""",E" & r & "-TODAY())"
        wsT.Cells(r, C_CAT).Value = categorie
        wsT.Cells(r, C_INTER).Value = interlocuteurs
        wsT.Cells(r, C_ACTION).Value = action
        wsT.Cells(r, C_DESC).Value = description
        wsT.Cells(r, C_RECUR).Value = recurrence
        wsT.Cells(r, C_SOURCE).Value = source
        wsT.Cells(r, C_REF).Value = reference
        wsT.Cells(r, C_ECH).NumberFormat = "dd/mm/yyyy"
        wsT.Range(wsT.Cells(r, 1), wsT.Cells(r, C_REF)).WrapText = True
        wsT.Range(wsT.Cells(r, 1), wsT.Cells(r, C_REF)).VerticalAlignment = xlTop
        nbAjouts = nbAjouts + 1
    Else
        ' mise à jour douce : on ne touche ni au statut, ni à la priorité, ni au titre
        If source = "Agenda" And recurrence <> "" Then wsT.Cells(r, C_ECH).Value = ech   ' prochaine occurrence
        If InStr(1, CStr(wsT.Cells(r, C_ACTION).Value), action, vbTextCompare) = 0 And Left$(action, 10) = "Engagement" Then
            wsT.Cells(r, C_ACTION).Value = action
        End If
        If Left$(cle, 11) = "SUPERVISION" Then
            wsT.Cells(r, C_TITRE).Value = titre
            wsT.Cells(r, C_DESC).Value = description
        End If
        nbMaj = nbMaj + 1
    End If

    wsT.Cells(r, C_CLE).Value = cle
    If entryId <> "" Then
        wsT.Cells(r, C_EID).Value = entryId
        If CStr(wsT.Cells(r, C_LIEN).Value) = "" Then wsT.Cells(r, C_LIEN).Value = "Outlook (Alt+F8 › OuvrirSource)"
    End If
End Sub

Private Function TrouverLigne(cle As String, titre As String, reference As String) As Long
    Dim r As Long, derniere As Long, ref As String
    derniere = DerniereLigne()
    For r = 2 To derniere
        If CStr(wsT.Cells(r, C_CLE).Value) = cle Then TrouverLigne = r: Exit Function
    Next r
    ' rattrapage des lignes créées sans clé (première génération, saisie manuelle)
    For r = 2 To derniere
        If CStr(wsT.Cells(r, C_CLE).Value) = "" Then
            ref = LCase$(CStr(wsT.Cells(r, C_REF).Value))
            If ref <> "" And Len(NettoyerSujet(titre)) >= 12 And (InStr(ref, LCase$(NettoyerSujet(titre))) > 0 _
               Or InStr(LCase$(reference), ref) > 0) Then TrouverLigne = r: Exit Function
        End If
    Next r
End Function

Private Function DerniereLigne() As Long
    DerniereLigne = wsT.Cells(wsT.Rows.Count, C_ID).End(xlUp).Row
End Function

Private Function NouvelId() As String
    Dim r As Long, n As Long, v As String, maxi As Long
    For r = 2 To DerniereLigne()
        v = CStr(wsT.Cells(r, C_ID).Value)
        If Left$(v, 1) = "T" And IsNumeric(Mid$(v, 2)) Then
            n = CLng(Mid$(v, 2)): If n > maxi Then maxi = n
        End If
    Next r
    NouvelId = "T" & Format(maxi + 1, "00")
End Function

Private Sub Horodater()
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets("Kanban")
    ws.Range("A2").Value = "Actualisé depuis Outlook le " & Format(Now, "dd/mm/yyyy à hh:nn") & _
        " · Change le statut dans l'onglet « Tâches » pour déplacer une carte."
End Sub

'==============================================================================
' OUVRIR LA SOURCE DE LA LIGNE SÉLECTIONNÉE
'==============================================================================
Public Sub OuvrirSource()
    Dim ws As Object, r As Long, v As String, it As Object
    Set ws = ThisWorkbook.Worksheets("Tâches")
    If ActiveSheet.Name <> "Tâches" Then
        MsgBox "Sélectionne une ligne dans l'onglet « Tâches ».", vbInformation: Exit Sub
    End If
    r = ActiveCell.Row
    v = CStr(ws.Cells(r, C_EID).Value)
    If Len(v) >= 20 Then
        On Error Resume Next
        Set it = CreateObject("Outlook.Application").GetNamespace("MAPI").GetItemFromID(v)
        On Error GoTo 0
        If Not it Is Nothing Then it.Display: Exit Sub
    End If
    If ws.Cells(r, C_LIEN).Hyperlinks.Count > 0 Then
        ws.Cells(r, C_LIEN).Hyperlinks(1).Follow
    Else
        MsgBox "Source introuvable pour cette ligne (élément déplacé ou supprimé ?).", vbExclamation
    End If
End Sub

'==============================================================================
' BOUTONS
'==============================================================================
Public Sub InstallerBoutons()
    Dim ws As Object, b As Object
    Set ws = ThisWorkbook.Worksheets("Kanban")
    On Error Resume Next
    ws.Buttons("btnActualiser").Delete
    ThisWorkbook.Worksheets("Tâches").Buttons("btnOuvrir").Delete
    On Error GoTo 0
    Set b = ws.Buttons.Add(ws.Range("E2").Left + ws.Range("E2").Width - 190, ws.Range("E1").Top + 4, 180, 26)
    b.Name = "btnActualiser"
    b.Caption = "Actualiser depuis Outlook"
    b.OnAction = "ActualiserKanban"

    Set ws = ThisWorkbook.Worksheets("Tâches")
    ws.Columns(C_LIEN).ColumnWidth = 14
    MsgBox "Bouton ajouté sur l'onglet Kanban." & vbCrLf & _
           "Astuce : pour ouvrir le mail d'une tâche, sélectionne la ligne puis Alt+F8 > OuvrirSource.", vbInformation
End Sub

'==============================================================================
' OUTILS
'==============================================================================
Private Function Param(libelle As String, defaut As Variant) As Variant
    Dim c As Object
    Set c = wsP.Columns(1).Find(What:=libelle, LookIn:=xlValues, LookAt:=xlWhole)
    If c Is Nothing Then
        Param = defaut
    ElseIf CStr(c.Offset(0, 1).Value) = "" Then
        Param = defaut
    Else
        Param = c.Offset(0, 1).Value
    End If
End Function

Private Function ContientUn(ByVal texte As String, ByVal liste As String) As Boolean
    Dim mots() As String, i As Long, m As String
    If liste = "" Or texte = "" Then Exit Function
    texte = LCase$(texte)
    mots = Split(liste, ";")
    For i = LBound(mots) To UBound(mots)
        m = LCase$(Trim$(mots(i)))
        If m <> "" Then
            If InStr(1, texte, m, vbTextCompare) > 0 Then ContientUn = True: Exit Function
        End If
    Next i
End Function

Private Function PhraseContenant(ByVal texte As String, ByVal liste As String) As String
    Dim phrases() As String, i As Long
    texte = Replace(Replace(texte, vbCr, " "), vbLf, " ")
    phrases = Split(texte, ".")
    For i = LBound(phrases) To UBound(phrases)
        If ContientUn(phrases(i), liste) Then PhraseContenant = Trim$(phrases(i)): Exit Function
    Next i
End Function

' Ne garde que le dernier message d'un fil (avant « De : » / « From: »)
Private Function PremierMessage(ByVal corps As String) As String
    Dim marqueurs, i As Long, p As Long, pos As Long
    marqueurs = Array(vbCrLf & "De :", vbCrLf & "De:", vbCrLf & "From:", vbCrLf & "-----Message d'origine", _
                      vbCrLf & "________________________________")
    pos = Len(corps) + 1
    For i = LBound(marqueurs) To UBound(marqueurs)
        p = InStr(1, corps, marqueurs(i), vbTextCompare)
        If p > 0 And p < pos Then pos = p
    Next i
    PremierMessage = Left$(corps, pos - 1)
End Function

Private Function NettoyerTexte(ByVal t As String, longueur As Long) As String
    t = Replace(t, vbCr, "")
    Do While InStr(t, vbLf & vbLf) > 0: t = Replace(t, vbLf & vbLf, vbLf): Loop
    Do While InStr(t, "  ") > 0: t = Replace(t, "  ", " "): Loop
    t = Trim$(t)
    If Len(t) > longueur Then t = Left$(t, longueur) & "..."
    NettoyerTexte = t
End Function

Private Function NettoyerSujet(ByVal s As String) As String
    Dim prefixes, i As Long, encore As Boolean
    prefixes = Array("RE:", "RE :", "TR:", "TR :", "FW:", "Fw:", "FWD:", "Réf :")
    Do
        encore = False
        s = Trim$(s)
        For i = LBound(prefixes) To UBound(prefixes)
            If UCase$(Left$(s, Len(prefixes(i)))) = UCase$(prefixes(i)) Then
                s = Mid$(s, Len(prefixes(i)) + 1): encore = True
            End If
        Next i
    Loop While encore
    NettoyerSujet = Trim$(s)
End Function

Private Function CategorieDe(texte As String) As String
    Dim r As Long
    r = 2
    Do While CStr(wsP.Cells(r, 4).Value) <> ""
        If ContientUn(texte, CStr(wsP.Cells(r, 4).Value)) Then CategorieDe = CStr(wsP.Cells(r, 5).Value): Exit Function
        r = r + 1
    Loop
    CategorieDe = "Paramétrage"
End Function

Private Function PrioriteDefaut(ech As Date, important As Boolean) As String
    If important Or ech - Date <= 3 Then
        PrioriteDefaut = "Haute"
    Else
        PrioriteDefaut = "Moyenne"
    End If
End Function

Private Function AdresseUtilisateur() As String
    On Error Resume Next
    AdresseUtilisateur = olNs.CurrentUser.AddressEntry.GetExchangeUser.PrimarySmtpAddress
    If AdresseUtilisateur = "" Then AdresseUtilisateur = olNs.CurrentUser.Address
End Function

Private Function AdresseExpediteur(it As Object) As String
    On Error Resume Next
    If it.SenderEmailType = "EX" Then
        AdresseExpediteur = it.Sender.GetExchangeUser.PrimarySmtpAddress
    Else
        AdresseExpediteur = it.SenderEmailAddress
    End If
    If AdresseExpediteur = "" Then AdresseExpediteur = it.SenderEmailAddress
End Function

Private Function AdresseOrganisateur(it As Object) As String
    On Error Resume Next
    AdresseOrganisateur = it.GetOrganizer.GetExchangeUser.PrimarySmtpAddress
    If AdresseOrganisateur = "" Then AdresseOrganisateur = it.Organizer
End Function
