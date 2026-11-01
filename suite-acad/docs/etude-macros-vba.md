# Macros VBA dans Calcul — état et étude d'une exécution par Excel

## Moteur utilisé aujourd'hui
- **Calcul** évalue les formules avec son propre moteur JavaScript (`applications/calcul/formules.js`,
  287 noms de fonctions français et anglais). Ce n'est pas Microsoft Excel.
- Les fichiers Excel sont lus par SheetJS CE 0.20.3 (Apache-2.0) et le lecteur de Calcul, puis réécrits par
  le générateur de Calcul (`xlsx.js`).
- **VBA** : aucun interpréteur. Les macros ne sont **jamais exécutées**, ni activées, quel que soit le fichier.

## Ce qui est livré (mode sûr de conservation)
- Format d'enregistrement `.xlsm` : le projet VBA d'origine (`xl/vbaProject.bin`, signatures éventuelles,
  relations) est recopié **octet pour octet**. Les noms de code du classeur et des feuilles sont repris, et le
  type de contenu « macroEnabled » est posé. Après écriture, le projet est comparé à l'original ; en cas
  d'écart, rien n'est écrit.
- Si l'utilisateur enregistre au format `.xlsx`, `.ods` ou `.csv` un classeur qui contient des macros, un
  avertissement bloquant propose trois choix : `.xlsm`, « sans les macros » ou « Annuler ».
- Avant tout enregistrement, l'utilisateur est averti des éléments que Calcul ne réécrit pas : boutons et contrôles
  de formulaire, ActiveX, ruban personnalisé, tableaux croisés dynamiques, connexions, tableaux structurés,
  segments, liaisons, formes.
- Une barre d'information et une fenêtre de détails listent les modules VBA (lus dans le flux `PROJECT` du
  conteneur OLE), la protection par mot de passe et la signature. Elles signalent aussi les fonctions non prises
  en charge : ces cellules affichent `#NOM?` et leur formule est conservée.
- « Ouvrir avec Excel… » réutilise la fonction existante « Ouvrir avec » du moteur, qui passe le fichier à Excel.
  Les règles de sécurité d'Excel s'appliquent alors (macros bloquées pour les fichiers venus d'Internet,
  emplacements approuvés).

## Étude : exécuter le VBA via Excel installé (COM)
| Point | Constat |
|---|---|
| Faisabilité technique | Possible par automation COM (`Excel.Application`, `Workbooks.Open`, `Application.Run`). Le moteur Go de SuiteAcad.exe utilise déjà COM pour « Réparer avec Excel » (`avecExcel`, `reparerAvecExcel`). En revanche, **aucune API n'expose l'exécution d'une macro**, et les sources Go ne sont pas disponibles : l'ajout impose de modifier et recompiler le lanceur. |
| Licence | Il faut une licence Microsoft 365 ou Office valide sur le poste. L'automatisation d'une application Office installée et utilisée de façon interactive par l'utilisateur licencié est admise. Microsoft déconseille et ne prend pas en charge l'automatisation sans surveillance (services, serveurs). |
| Versions | COM est stable d'Excel 2010 à Microsoft 365. Excel s'exécute hors processus, donc 32 et 64 bits sont compatibles avec le lanceur 64 bits. Depuis 2022, les macros des fichiers marqués « venant d'Internet » sont bloquées par défaut (Mark of the Web), et il faut respecter ce blocage. |
| Sécurité | Lancer une macro par COM contourne l'avertissement de la barre de sécurité d'Excel. L'exécution ne peut donc être autorisée que pour un fichier explicitement approuvé (emplacement approuvé, signature valide, accord de l'utilisateur à chaque fois). |
| Déploiement | Rien à installer de plus si Excel est présent. Sans Excel, la fonction doit être désactivée et expliquée. |

**Décision** : sans les sources du lanceur Go, l'intégration COM d'exécution n'est pas réalisable proprement dans
cette tranche. Le mode sûr de conservation est livré, avec ouverture dans Excel pour l'exécution. Pour aller plus loin,
il faudrait un point d'API `/api/excel/executer-macro`, réservé aux fichiers approuvés, qui respecte le blocage
Mark of the Web et journalise chaque exécution.

## Fonctions non prises en charge
Toute fonction absente de `FONCTIONS` est listée à l'ouverture (barre d'information, Informations, Détails).
