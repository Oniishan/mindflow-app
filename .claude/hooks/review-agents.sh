#!/usr/bin/env bash
# Stop hook: after Claude produces or changes files, ask it to run the review
# agents in parallel before handing back. State lives in .claude/.review-state
# (gitignored) so the same changes are never reviewed twice.
set -u

INPUT="$(cat)"
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

STATE=".claude/.review-state"
EXCLUDE=(':(exclude).claude' ':(exclude)CLAUDE.md')

head_sha="$(git rev-parse HEAD 2>/dev/null || echo none)"
signature="$( { echo "$head_sha"; git status --porcelain -- . "${EXCLUDE[@]}"; git diff HEAD -- . "${EXCLUDE[@]}" 2>/dev/null; } | git hash-object --stdin)"

last_sig=""; base="$head_sha"
if [ -f "$STATE" ]; then
  last_sig="$(sed -n 1p "$STATE")"
  base="$(sed -n 2p "$STATE")"
fi
save() { printf '%s\n%s\n' "$1" "$2" > "$STATE"; }

# First run in this clone: record a baseline, review nothing.
[ -f "$STATE" ] || { save "$signature" "$head_sha"; exit 0; }

# Already reviewed this exact state.
[ "$signature" = "$last_sig" ] && exit 0

# We are already continuing because of this hook: accept the post-review state
# (fixes made by the reviewers) without starting another review loop.
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  save "$signature" "$head_sha"; exit 0
fi

git cat-file -e "$base^{commit}" 2>/dev/null || base="$head_sha"
changed="$( { git diff --name-only "$base" -- . "${EXCLUDE[@]}"; git ls-files --others --exclude-standard -- . "${EXCLUDE[@]}"; } | sort -u)"
[ -z "$changed" ] && { save "$signature" "$head_sha"; exit 0; }

save "$signature" "$head_sha"
files="$(printf '%s' "$changed" | head -50 | sed 's/^/- /')"

reason="Revue automatique (règle du projet) : des fichiers ont été produits ou modifiés depuis $base.

Fichiers :
$files

Réunis l'équipe : lance EN PARALLÈLE (un seul message, plusieurs appels Agent) tous les agents du tableau « Après avoir produit » de CLAUDE.md (section « Équipe d'agents »), en leur donnant cette liste et la commande \`git diff $base\` (+ fichiers non suivis).
Ensuite : corrige les problèmes CRITICAL et HIGH, puis présente le tableau récapitulatif par rôle (✅ / ⚠️ / ❌)."

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
