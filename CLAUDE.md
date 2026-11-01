# MindFlow App

Pages HTML autonomes (`Renta1.html`, `Renta1 B.html`).

## ECC (Everything Claude Code)

Ce dépôt intègre [ECC](https://github.com/affaan-m/ECC) :

- **Plugin `ecc@ecc`** déclaré au niveau projet dans `.claude/settings.json`
  (agents, skills, commandes et hooks d'ECC). Claude Code propose de l'installer
  à l'ouverture du projet — accepter la marketplace `ecc` quand c'est demandé.
- **Règles locales** dans `.claude/rules/ecc/` (`common` + `web`), adaptées à un
  projet HTML/CSS/JS.

Ne pas lancer `./install.sh --profile full` d'ECC en plus du plugin (doublons).
