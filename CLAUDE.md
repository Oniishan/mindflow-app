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

## Équipe d'agents (obligatoire)

Chaque production dans ce projet passe par une équipe complète, comme dans une vraie
agence. Claude joue le **chef de projet** : il répartit le travail, lance les agents
**en parallèle** (un seul message, plusieurs appels Agent), arbitre et fait la synthèse.

### Avant de produire (nouvelle page, fonctionnalité, refonte)

| Rôle | Agent |
|---|---|
| Product manager — besoin, étapes, risques | `ecc:planner` |
| Architecte — structure, choix techniques | `ecc:architect` |

Pour une simple correction, cette étape est facultative.

### Après avoir produit — revue automatique par les agents

Déclenchée par le hook `Stop` (`.claude/hooks/review-agents.sh`) dès que des fichiers ont
changé. Toute l'équipe relit les changements en parallèle :

| Rôle | Agent | Regarde |
|---|---|---|
| Lead dev | `ecc:code-reviewer` | qualité, lisibilité, bugs |
| Dev front JS | `ecc:typescript-reviewer` | JavaScript/TypeScript (si présent) |
| Simplification | `ecc:code-simplifier` | code inutilement compliqué |
| Sécurité | `ecc:security-reviewer` | XSS, secrets, données utilisateur |
| QA | `ecc:silent-failure-hunter` | erreurs silencieuses, cas limites |
| QA navigateur | `ecc:e2e-runner` | parcours clés dans le navigateur |
| Accessibilité | `ecc:a11y-architect` | WCAG 2.2, clavier, contrastes |
| Performance | `ecc:performance-optimizer` | poids, chargement, Core Web Vitals |
| SEO | `ecc:seo-specialist` | balises, structure, données structurées |
| Rédaction / marketing | `ecc:marketing-agent` | textes visibles, clarté, ton |
| Documentation | `ecc:doc-updater` | README / docs à jour |

Règles :
- Les relecteurs **rapportent**, le chef de projet **corrige** : appliquer tous les
  CRITICAL et HIGH, puis les MEDIUM raisonnables.
- Un agent sans objet (ex. pas de JS modifié) répond « rien à signaler » — ne pas le
  sauter en silence, l'indiquer dans le récapitulatif.
- Si un agent `ecc:*` n'est pas disponible (plugin non chargé), lancer un agent
  `general-purpose` avec le même rôle et la même consigne.
- Terminer par un tableau récapitulatif : rôle · verdict (✅ / ⚠️ / ❌) · ce qui a été corrigé.
