#!/bin/bash
# Lance toutes les suites de tests de bout en bout sur l'installation Wine indiquée par WINEPREFIX.
cd "$(dirname "$0")/.."
python3 tests/creer_fichiers.py > /dev/null
code=0
for t in p1_historique p2_depannage p3_macros p4_publipostage p5_conversions; do
  timeout 900 node tests/$t.mjs > tests/resultats/$t.log 2>&1 || code=1
  tail -1 tests/resultats/$t.log
done
exit $code
