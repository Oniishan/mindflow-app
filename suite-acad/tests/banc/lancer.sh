#!/bin/bash
# usage: lancer.sh <app> [args...]  -> prints URL, leaves wine running (pid in /tmp/sarun/wine.pid)
export WINEDEBUG=-all WINEPREFIX=${WINEPREFIX:-/tmp/wineprefix} ATELIER_VERBEUX=1 LANG=C.UTF-8 LC_ALL=C.UTF-8
cd /tmp/sarun; rm -f edge-args.txt stop-edge
P=/tmp/wineprefix/drive_c/users/root/AppData/Local/Programs/SuiteAcad
app=$1; shift
nohup wine "$P/SuiteAcad.exe" --app "$app" "$@" > /tmp/sarun/wine-$app.log 2>&1 &
echo $! > /tmp/sarun/wine.pid
for i in $(seq 1 60); do [ -s edge-args.txt ] && break; sleep 0.5; done
grep -o 'http://127.0.0.1:[0-9]*/' edge-args.txt | head -1
