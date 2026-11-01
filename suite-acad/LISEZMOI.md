# Suite Acad’ 1.2.0 — modules mis à jour

Ce dossier contient les sources des applications de Suite Acad’ (Calcul, Texte, PDF, Diapo, FonctionGrist,
Dépannage, et la nouvelle application Publipostage), ainsi que le **dépôt de mises à jour 1.2.0** prêt à
installer.

Les sources des modules ont été extraites de `SuiteAcad.exe` 1.1.0 : elles sont identiques octet pour octet
aux archives d'origine (commit `e968ec9`). Le lanceur `SuiteAcad.exe` (Go + WebView2) n'est **pas modifié** :
les nouveautés passent par son mécanisme officiel de mise à jour.

## Installer la version modifiée sur les postes
1. Copier le dossier **`depot/`** sur un partage accessible aux postes (ou en local).
2. Dans Suite Acad’ : **Réglages > Mises à jour > Source des mises à jour**, indiquer ce dossier. Pour l'imposer
   à tous les postes, utiliser le champ `sourceMaj` de `politique.json`.
3. Cliquer sur **Rechercher des mises à jour**, puis sur **Tout mettre à jour**. L'application **Publipostage**
   apparaît comme nouvelle application : bouton « Installer » sur sa carte.

Les archives sont vérifiées par le lanceur (taille et SHA-256 inscrits dans `catalogue.json`). Le dépôt ne
contient pas `SuiteAcad.exe`, qui reste en version 1.1.0. Pour le joindre au dépôt :
`--exe chemin/SuiteAcad.exe` (voir ci-dessous).

## Reconstruire le dépôt après une modification
```bash
python3 suite-acad/outils/construire_depot.py --sortie suite-acad/depot
```
- La version de chaque application est lue dans `applications/<id>/manifeste.json` (`version` et `versions[0]`).
- `commun/` est copié dans chaque archive. Les bibliothèques de `vendor/` sont ajoutées selon le fichier
  `applications/<id>/.vendor`.
- Les archives sont reproductibles : à sources identiques, mêmes octets.

## Tester (vrai moteur SuiteAcad.exe sous Wine + Chromium)
Voir `tests/banc/LISEZMOI.md` pour la préparation : Wine, installation 1.1.0, faux `msedge.exe`. Ensuite :
```bash
tests/banc/maj.sh "$PWD/depot" publipostage   # met à jour l'installation de test depuis le dépôt
tests/lancer-tous.sh                          # 5 suites, rapports dans tests/resultats/
```

## Ce qui a changé (1.2.0)
| Priorité | Application | Contenu |
|---|---|---|
| 1 | Calcul (+ commun) | Historique des versions : copie vérifiée avant chaque enregistrement, restauration ou réparation. Restauration en 2 actions. Conservation 30 jours réglable ; la dernière copie saine n'est jamais purgée. Enregistrement sûr : relu avant écriture, écriture atomique, relu après écriture. |
| 2 | Dépannage | « Dépannage de Calcul et des classeurs » : diagnostic sans modification, plan de réparation, copie dans l'historique, contrôle réel du résultat. Les interventions sur Excel et Windows sont séparées et confirmées. |
| 3 | Calcul | Classeurs `.xlsm` : projet VBA conservé octet pour octet et vérifié, avertissements avant toute perte, macros jamais exécutées. Moteur et fonctions non prises en charge indiqués. Étude : `docs/etude-macros-vba.md`. |
| 4 | Publipostage (nouvelle) | Données XLSX/ODS/CSV, modèle Word ou texte, contrôle, aperçu, Word ou PDF, noms sûrs, liste d'envoi pour Fusion PJ. Comparaison des références : `docs/publipostage-references.md`. |
| 5 | PDF, Texte | PDF vers Word modifiable (pages numérisées détectées, OCR local si disponible, sinon image signalée). Texte vers PDF direct et prévisible. |

## Limites connues
- Les tests tournent sous Wine avec Chromium, pas sous Windows avec WebView2. Les actions COM et Excel (réparation
  avec Excel, conversion .xls) n'ont pu être vérifiées que dans leur cas d'échec (« Excel n'est pas installé »).
- L'historique ne suit que les opérations faites dans Suite Acad’ : pas les modifications faites dans Excel, ni
  les déplacements ou suppressions dans l'Explorateur. Les copies restent sur le poste.
- Macros : conservées, jamais exécutées. L'exécution via Excel (COM) demanderait une évolution du lanceur Go,
  dont les sources ne sont pas disponibles.
- PDF produits par Publipostage depuis un modèle Word : mise en page simplifiée (polices standard, sans en-têtes
  ni pieds de page Word). Les `.docx` produits, eux, sont fidèles au modèle.
- PDF vers Word : la mise en page est reconstruite (pas de colonnes, de tableaux ni d'images des pages de texte).
  Aucun moteur OCR n'est ajouté : celui du navigateur n'est utilisé que s'il est activé.
