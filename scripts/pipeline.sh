#!/usr/bin/env bash
# Usage: bash scripts/pipeline.sh tasks/m2-session-a.md
# Claude builds -> Codex reviews -> Claude fixes (max 2 rounds) -> STOP.
# You test, push and deploy yourself.
set -euo pipefail

TASK_FILE="${1:?Usage: bash scripts/pipeline.sh <task-file>}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
MAX_ROUNDS=2

[ -f "$TASK_FILE" ] || { echo "Task file not found: $TASK_FILE"; exit 1; }
[ "$BRANCH" != "main" ] || { echo "Switch to a milestone branch first (e.g. git checkout -b m2-editor)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first."; exit 1; }

# Claude may edit files and run only these commands. It cannot push or deploy.
CLAUDE_TOOLS=(--permission-mode acceptEdits
  --allowedTools "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status:*)" \
                 "Bash(git diff:*)" "Bash(npm:*)" "Bash(npx wrangler deploy --dry-run:*)")

echo "== 1. Claude builds =="
claude -p "Read AGENTS.md (Builder role) and $TASK_FILE. Implement the task, run available checks, and commit. Do not push or deploy." "${CLAUDE_TOOLS[@]}"

APPROVED=0
# One more review than fixes, so the last fix is reviewed too.
for i in $(seq 1 "$((MAX_ROUNDS + 1))"); do
  echo "== 2. Codex review, round $i =="
  codex exec --sandbox read-only \
    "Read AGENTS.md (Reviewer role). Review git diff main...HEAD and follow the output rules exactly." \
    > .review.md || true
  cat .review.md

  if tail -n 1 .review.md | grep -qx "LGTM"; then
    APPROVED=1
    break
  fi

  # That was the review of the last allowed fix.
  [ "$i" -le "$MAX_ROUNDS" ] || break

  echo "== Claude fixes, round $i =="
  claude -p "Read AGENTS.md (Builder role) and .review.md. Fix high and medium problems only, then commit." "${CLAUDE_TOOLS[@]}"
done

echo
if [ "$APPROVED" -eq 1 ]; then
  echo "Codex approved (LGTM) on branch: $BRANCH"
else
  echo "NOT approved after $MAX_ROUNDS fix rounds. Read .review.md and decide yourself."
fi

echo "Next, by hand:"
echo "  1. npm run dev        (test in the browser)"
echo "  2. git log --oneline main..HEAD && git diff main --stat   (see what changed)"
echo "  3. git push -u origin $BRANCH"
echo "  4. merge to main, then: npm run deploy"
