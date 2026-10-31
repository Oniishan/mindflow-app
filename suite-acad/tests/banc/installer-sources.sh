#!/bin/bash
# Copie les sources d'une application dans l'installation de test (Wine) — pour itérer sans repasser par le dépôt.
# usage : installer-sources.sh calcul [texte ...]
RACINE=$(cd "$(dirname "$0")/../.." && pwd)
P=${WINEPREFIX:-/tmp/wineprefix}/drive_c/users/root/AppData/Local/Programs/SuiteAcad/Applications
for app in "$@"; do
  D=$P/$app; mkdir -p "$D/commun/vendor"
  cp -r "$RACINE/applications/$app/." "$D/"; rm -f "$D/.vendor"
  cp -r "$RACINE/commun/." "$D/commun/"
  for v in $(cat "$RACINE/applications/$app/.vendor" 2>/dev/null); do cp "$RACINE/vendor/$v" "$D/commun/vendor/"; done
done
