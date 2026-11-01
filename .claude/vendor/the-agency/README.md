# TheAgency (intégration légère)

Sélection copiée depuis [the-agency-ai/the-agency](https://github.com/the-agency-ai/the-agency)
(commit `3edc4e0b201bcd9c185b34b414fb792145792b67`), licence MIT (voir `LICENSE`).

Uniquement des skills/commandes autonomes — pas de hooks, pas d'outils `agency/tools`,
pas de base ISCP. Les chemins `agency/workstreams/` ont été remplacés par `docs/`.

| Fichier | Rôle |
|---|---|
| `.claude/commands/discuss.md` | `/discuss` — protocole 1B1 : un point à la fois jusqu'à décision |
| `.claude/skills/define/` | `/define` — rédiger la vision produit & exigences (PVR) |
| `.claude/skills/design/` | `/design` — rédiger l'architecture & design (A&D) |
| `.claude/skills/diff-summary/` | `/diff-summary` — distinguer changements de forme / de fond |
| `.claude/skills/review-pr/` | `/review-pr` — relire une PR, poster après accord |
| `.claude/skills/pr-respond/` | `/pr-respond` — répondre aux commentaires de revue |
| `.claude/skills/session-list/` | `/session-list` — lister les sessions Claude Code passées |
| `.claude/skills/session-read/` | `/session-read` — résumer une session passée |

Installation complète (hooks, agents, outils) : `agency init`, voir le README amont.
