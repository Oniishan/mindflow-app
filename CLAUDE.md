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

## TheAgency (intégration légère)

Sélection de skills/commandes de [TheAgency](https://github.com/the-agency-ai/the-agency)
dans `.claude/skills/` et `.claude/commands/` — détail dans `.claude/vendor/the-agency/README.md`.
Workflow conseillé : `/define` (besoin) → `/design` (architecture) → implémentation, avec
`/discuss` pour trancher les points un par un. Les documents produits vont dans `docs/`.
