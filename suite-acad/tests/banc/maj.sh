#!/bin/bash
# usage: maj.sh <dossier_depot_linux>  -> configure la source et lance « Tout mettre à jour » via le vrai lanceur
DEP=$1; WIN="Z:$(echo $DEP | sed 's#/#\\#g')"
L=/tmp/wineprefix/drive_c/users/root/AppData/Local/SuiteAcad
python3 - "$WIN" <<'PY'
import json,sys
p='/tmp/wineprefix/drive_c/users/root/AppData/Local/SuiteAcad/reglages.json'
r=json.load(open(p)); r['sourceMaj']=sys.argv[1]; r['modeMaj']='auto'; json.dump(r,open(p,'w'),indent=2)
PY
export WINEDEBUG=-all WINEPREFIX=/tmp/wineprefix
cd /tmp/sarun; rm -f edge-args.txt stop-edge
P=/tmp/wineprefix/drive_c/users/root/AppData/Local/Programs/SuiteAcad
nohup wine "$P/SuiteAcad.exe" > /tmp/sarun/wine-lanceur.log 2>&1 &
for i in $(seq 1 60); do [ -s edge-args.txt ] && break; sleep 0.5; done
U=$(grep -o 'http://127.0.0.1:[0-9]*/' edge-args.txt | head -1)
J=$(curl -s $U | grep -o '"jeton":"[0-9a-f]*"' | cut -d'"' -f4)
curl -s -H "X-Suite-Jeton: $J" -H 'Content-Type: application/json' -d '{}' ${U}api/verifier; echo
sleep 4
curl -s -H "X-Suite-Jeton: $J" -H 'Content-Type: application/json' -d '{}' ${U}api/tout-mettre-a-jour; echo
for i in $(seq 1 40); do sleep 1; grep -q "1.2.0" $L/installations.json && [ $(grep -c '"1.2.0"' $L/installations.json) -ge ${ATTENDU:-1} ] && break; done
sleep 2
python3 -c "import json;d=json.load(open('$L/installations.json'));print({k:(v['version'],v.get('source')) for k,v in d.items()})"
tail -12 $L/journal.log
$(dirname "$0")/arreter.sh
