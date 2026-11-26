#!/usr/bin/env bash
# bash scripts/pipeline.sh plan             -> Codex plans the next unchecked phase
# bash scripts/pipeline.sh run <phase-id>   -> build, review, test, plan next, STOP
set -euo pipefail

MODE="${1:?Usage: pipeline.sh plan | run <phase-id>}"
MAX_ROUNDS=2
mkdir -p .pipeline tasks tests

CLAUDE_TOOLS=(--permission-mode acceptEdits
  --allowedTools "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status:*)" \
                 "Bash(git diff:*)" "Bash(npm:*)" "Bash(npx wrangler deploy --dry-run:*)")

next_phase() { grep -m1 -oP '^- \[ \] \K[a-z0-9-]+' ROADMAP.md || true; }
mark_done()  { sed -i "s/^- \[ \] $1 /- [x] $1 /" ROADMAP.md; }

# Stop if an agent edited files outside its allowed paths (regex of allowed paths).
guard() {
  local bad
  bad=$(git status --porcelain | cut -c4- | grep -Ev "$1" || true)
  if [ -n "$bad" ]; then
    echo "STOPPED: an agent changed files outside its allowed paths:"; echo "$bad"; exit 1
  fi
}

require_clean() {
  [ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first."; exit 1; }
}

write_plan() {  # Codex writes tasks/<phase>.md
  local phase="$1"
  echo "== Codex plans: $phase =="
  codex exec --sandbox workspace-write \
    "Read AGENTS.md (Planner role) and ROADMAP.md. Inspect the current code. Write the build plan for phase '$phase' to tasks/$phase.md: concrete steps, files, and a 'Done when' section copied from the roadmap. Stay inside the roadmap scope. Edit no other file."
  guard '^tasks/'
  git add tasks && git commit -qm "plan: $phase" || true
}

review() {  # 0 if Codex ends its review with LGTM
  codex exec --sandbox read-only \
    "Read AGENTS.md (Reviewer role). Review git diff main...HEAD and follow the output rules exactly." \
    > .pipeline/review.md || true
  cat .pipeline/review.md
  grep -v '^[[:space:]]*$' .pipeline/review.md | tail -n 1 | grep -qx 'LGTM'
}

review_loop() {
  for i in $(seq 1 "$MAX_ROUNDS"); do
    echo "== Codex review, round $i =="
    if review; then return 0; fi
    echo "== Claude fixes, round $i =="
    claude -p "Read AGENTS.md (Builder role) and .pipeline/review.md. Fix high and medium problems only, then commit." "${CLAUDE_TOOLS[@]}"
  done
  echo "== Codex final review =="
  review
}

# ---------------------------------------------------------------- plan mode
if [ "$MODE" = "plan" ]; then
  require_clean
  PHASE="$(next_phase)"
  [ -n "$PHASE" ] || { echo "Roadmap complete."; exit 0; }
  write_plan "$PHASE"
  echo "Read tasks/$PHASE.md, then: bash scripts/pipeline.sh run $PHASE"
  exit 0
fi

# ----------------------------------------------------------------- run mode
PHASE="${2:?Usage: pipeline.sh run <phase-id>}"
TASK="tasks/$PHASE.md"
[ -f "$TASK" ] || { echo "No plan at $TASK. Run: bash scripts/pipeline.sh plan"; exit 1; }
require_clean
if git rev-parse --verify -q "$PHASE" >/dev/null; then git checkout "$PHASE"; else git checkout -b "$PHASE"; fi
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "Do not run on main."; exit 1; }

echo "== 1. Claude builds =="
claude -p "Read AGENTS.md (Builder role) and $TASK. Implement it, run available checks, commit. Do not push or deploy." "${CLAUDE_TOOLS[@]}"

echo "== 2. Review loop =="
review_loop || { echo "NOT APPROVED after $MAX_ROUNDS rounds. Read .pipeline/review.md."; exit 1; }

if ! grep -q '"test"' package.json; then
  echo "No npm test script yet: skipping the test stage."
else
  echo "== 3. Claude writes the test spec =="
  claude -p "Read AGENTS.md (Test-spec writer role), $TASK and git diff main...HEAD. Write .pipeline/test-spec.md. No code." "${CLAUDE_TOOLS[@]}"

  echo "== 4. Codex writes the tests =="
  codex exec --sandbox workspace-write \
    "Read AGENTS.md (Test writer role) and .pipeline/test-spec.md. Write automated tests under tests/ for every item. Make sure 'npm test' runs them. Do not edit app code."
  guard '^(tests/|package(-lock)?\.json$|playwright\.config\.)'

  PASSED=0
  for i in $(seq 1 $((MAX_ROUNDS + 1))); do
    echo "== 5. npm test, attempt $i =="
    if npm test > .pipeline/test-output.txt 2>&1; then PASSED=1; break; fi
    tail -n 40 .pipeline/test-output.txt
    [ "$i" -le "$MAX_ROUNDS" ] || break

    rm -f .pipeline/code-bug.md
    echo "== Codex triage =="
    codex exec --sandbox workspace-write \
      "Read AGENTS.md (Test writer role) and .pipeline/test-output.txt. Decide if the test or the app is wrong, and act as the role says."
    guard '^(tests/|package(-lock)?\.json$|playwright\.config\.)'

    if [ -f .pipeline/code-bug.md ]; then
      echo "== Claude fixes the app bug =="
      claude -p "Read AGENTS.md (Builder role) and .pipeline/code-bug.md. Fix the app bug only, then commit." "${CLAUDE_TOOLS[@]}"
      review_loop || { echo "Fix not approved. Read .pipeline/review.md."; exit 1; }
    fi
  done

  [ "$PASSED" -eq 1 ] || { echo "TESTS STILL FAILING. Read .pipeline/test-output.txt."; exit 1; }
  git add -A && git commit -qm "$PHASE: add tests" || true
fi

echo "== 6. Phase done. Planning the next one =="
mark_done "$PHASE"
git add ROADMAP.md && git commit -qm "roadmap: $PHASE done" || true
NEXT="$(next_phase)"
if [ -z "$NEXT" ]; then echo "Roadmap complete."; exit 0; fi
write_plan "$NEXT"

echo
echo "PHASE $PHASE PASSED (reviewed + tests green). Waiting for you:"
echo "  1. npm run dev, test in the browser; check git diff main --stat"
echo "  2. git push -u origin $PHASE; merge to main; npm run deploy (you do these)"
echo "  3. git checkout main && git pull"
echo "  4. read tasks/$NEXT.md (edit if needed), then:"
echo "       bash scripts/pipeline.sh run $NEXT"