---
description: Lancer l'équipe d'agents pour la vérification finale du projet (revue complète en parallèle, corrections, récapitulatif)
---

# /equipe — vérification finale par l'équipe d'agents

Arguments (optionnels) : `$ARGUMENTS` — liste de rôles à lancer (ex. `sécurité accessibilité`)
ou un chemin / une plage git à vérifier. Sans argument : toute l'équipe, sur tout le projet.

1. **Périmètre** : déterminer les fichiers du projet à vérifier (par défaut tous les fichiers
   suivis hors `.claude/`; si une plage git est donnée, `git diff <plage>`).
2. **Équipe** : lancer **en parallèle** (un seul message, plusieurs appels Agent) les agents du
   tableau « L'équipe » de `CLAUDE.md` (ou seulement les rôles demandés), en donnant à chacun
   le périmètre et son rôle. Agent `ecc:*` indisponible → `general-purpose` avec le même rôle.
3. **Corrections** : appliquer les CRITICAL et HIGH, puis les MEDIUM raisonnables.
4. **Récapitulatif** : tableau rôle · verdict (✅ / ⚠️ / ❌) · corrigé · reste à faire.
