#!/bin/bash
# usage : maj.sh <dossier_depot> [applications...]
# Indique le dépôt comme source de mises à jour, puis, via le vrai lanceur : vérification,
# installation des applications demandées (ex. publipostage) et « Tout mettre à jour ».
ICI=$(cd "$(dirname "$0")" && pwd)
DEP=$1; shift; WIN="Z:$(echo $DEP | sed 's#/#\\#g')"
export WINEDEBUG=-all WINEPREFIX=${WINEPREFIX:-/tmp/wineprefix} LANG=C.UTF-8 LC_ALL=C.UTF-8
L=$WINEPREFIX/drive_c/users/root/AppData/Local/SuiteAcad
python3 - "$WIN" "$L/reglages.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[2])); r['sourceMaj']=sys.argv[1]; r['modeMaj']='auto'; json.dump(r,open(sys.argv[2],'w'),indent=2)
PY
cd /tmp/sarun; rm -f edge-args.txt stop-edge
nohup wine "$WINEPREFIX/drive_c/users/root/AppData/Local/Programs/SuiteAcad/SuiteAcad.exe" > /tmp/sarun/wine-lanceur.log 2>&1 &
for i in $(seq 1 60); do [ -s edge-args.txt ] && break; sleep 0.5; done
U=$(grep -o 'http://127.0.0.1:[0-9]*/' edge-args.txt | head -1); J=$(curl -s $U | grep -o '"jeton":"[0-9a-f]*"' | cut -d'"' -f4)
api(){ curl -s -H "X-Suite-Jeton: $J" -H 'Content-Type: application/json' -d "$2" ${U}api/$1; echo; }
api verifier '{}'; sleep 5
if [ $# -gt 0 ]; then api lanceur/installer "{\"bureau\":false,\"demarrage\":false,\"applications\":[$(printf '"%s",' "$@" | sed 's/,$//')]}"; sleep 12; fi
api tout-mettre-a-jour '{}'; sleep 15
python3 -c "import json;d=json.load(open('$L/installations.json'));print({k:(v['version'],v.get('source')) for k,v in d.items()})"
$ICI/arreter.sh
