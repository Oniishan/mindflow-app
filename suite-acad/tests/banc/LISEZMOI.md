# Banc d'essai : vrai moteur SuiteAcad.exe sous Wine + Chromium

SuiteAcad.exe (Go + WebView2) tourne sous Wine ; sans WebView2, il bascule sur son mode
de secours « Microsoft Edge en mode application ». Un faux `msedge.exe` (outils/faux-edge)
récupère l'adresse `http://127.0.0.1:<port>/` que Chromium (Playwright) ouvre ensuite :
les tests pilotent donc l'interface réelle **et** l'API réelle du moteur (écriture atomique,
dossier de récupération, préférences…).

Préparation (une fois) :
```bash
apt-get install -y wine64 inotify-tools
export WINEPREFIX=/tmp/wineprefix
wine SuiteAcad.exe --installer --silencieux --applications=toutes
(cd tests/banc/faux-edge && GOOS=windows GOARCH=amd64 go build -o msedge.exe .)
mkdir -p "$WINEPREFIX/drive_c/Program Files (x86)/Microsoft/Edge/Application"
cp tests/banc/faux-edge/msedge.exe "$WINEPREFIX/drive_c/Program Files (x86)/Microsoft/Edge/Application/"
```
Limites : Wine n'est pas Windows (pas d'Excel, pas de WebView2) ; les tests valident la logique
des modules et l'API du moteur, pas le rendu WebView2 ni les actions COM/Excel.
