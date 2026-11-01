# Publipostage : comparaison des références et choix retenus

Références analysées (fichiers fournis, lus sans être exécutés) :
- **Fusion PJ 1.4.3** (`Installer-FusionPJ-v1.4.3.cmd`) : script d'installation PowerShell qui contient deux
  extensions Thunderbird (`fusion-pj-1.4.3.xpi`, `fusion-pj-envoi-1.0.0.xpi`). L'objet est l'envoi de courriels
  avec pièces jointes : un message à plusieurs personnes, ou un fichier par destinataire. Il associe les fichiers
  par nom, par contenu de PDF ou par une colonne « fichier », découpe un gros PDF par destinataire, propose des
  champs avec valeur par défaut `{{Prénom|Madame, Monsieur}}`, un contrôle avant envoi et un journal.
- **Publipostage Express** (`Publipostage_Express.html`) : page hors ligne qui fusionne Excel et Word (SheetJS et
  docxtemplater). Elle convertit les MERGEFIELD, produit un Word par ligne ou un seul Word, nomme les fichiers
  selon un motif, filtre les lignes, affiche un aperçu surligné, crée un modèle express, conserve les macros
  `.docm` et exporte une liste Mail Merge pour Thunderbird.

| Fonction | Fusion PJ | Express | Publipostage Suite Acad’ |
|---|---|---|---|
| Données Excel / CSV / ODS | Excel, CSV, carnet TB | Excel, CSV, ODS | Excel (.xlsx/.xlsm/.xls), ODS, CSV (UTF-8 ou Windows-1252, séparateur détecté) |
| Modèle Word {Champ} / MERGEFIELD / «Champ» | — (message TB) | oui | oui (balises éclatées sur plusieurs segments regroupées) |
| Valeur par défaut | `{{X\|défaut}}` | — | `{X\|défaut}` |
| Modèle texte rédigé dans l'application | message | — | oui, insertion de champ au curseur |
| Contrôle : champs sans colonne, valeurs manquantes, doublons, adresses | partiel (adresses, fichiers) | champs | tous, avec numéros de ligne |
| Aperçu par destinataire | oui | oui (surlignage) | oui (surlignage, manques en rouge) |
| Word par ligne / Word unique | — | oui | oui |
| PDF | découpe de PDF existant | — | PDF par ligne ou unique (rendu simplifié) |
| Noms de fichiers sûrs, sans écrasement | — | oui (doublons numérotés) | oui, plus noms réservés Windows et fichiers déjà présents |
| Choix du dossier, vérification après écriture | — | téléchargement | dossier choisi ou sous-dossier daté, relecture SHA-256 |
| Envoi des courriels | oui (Thunderbird) | liste Mail Merge | **liste-envoi.csv** (courriel + fichier), à utiliser dans Fusion PJ avec la méthode « le tableau contient le nom du fichier » |

**Non repris** : l'envoi de courriels (c'est le rôle de Fusion PJ dans Thunderbird ; Suite Acad’ n'a pas de
messagerie), le découpage d'un PDF existant, et la conservation des macros dans les modèles `.docm`. Ces macros
sont signalées et retirées des `.docx` produits.
Le code de Publipostage Express a servi de référence pour la conversion des MERGEFIELD et le format des nombres
et des dates. Aucune bibliothèque supplémentaire n'a été ajoutée : fflate, SheetJS, mammoth et pdf-lib sont déjà
fournis avec la suite.
