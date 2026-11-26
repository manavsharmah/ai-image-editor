# Project: AI Photo Look Editor

A free, browser-based photo editor. The user uploads a photo; AI or a
reference image sets color sliders; the user fine-tunes and downloads.
It never transforms content (no background removal, no generative edits).
It only adjusts exposure, tone, color and HSL.

## Structure (monorepo)
- apps/web            static frontend (vanilla HTML/CSS/JS, WebGL2).
                      EVERYTHING in this folder is public.
- apps/web/shared     look-schema.js: single source of truth for sliders,
                      imported by both the browser and the Worker.
                      Pure JS, no imports, no secrets.
- apps/api            Hono API on one Cloudflare Worker
- tasks/              one markdown file per task (the prompt for the builder)
- scripts/            pipeline.sh and other automation

## Hard rules
1. Vanilla HTML/CSS/JS only. No frontend frameworks or build-heavy tooling.
2. Backend is Hono on ONE Cloudflare Worker; static files are served via
   Workers static assets (apps/web). /api/* always reaches the Worker first.
3. Photos are processed only in the browser and never uploaded. The server
   only ever receives text prompts.
4. Every slider value goes through apps/web/shared/look-schema.js
   (names, min, max, default, clampLook(), validateLook()). Never
   hardcode slider names or ranges elsewhere. The slider UI is generated
   from the schema.
5. All AI output is untrusted: validate, clamp, and fall back to keyword
   matching if it is invalid.
6. Stay on the free tier. No paid services, no payment-required features.
7. Never put secrets in apps/web. Never commit .env, .dev.vars or tokens.
8. Keep it simple. Small readable files, short comments on anything
   non-obvious.

## Phase 1 scope (do NOT build beyond this)
Manual sliders, text prompt -> AI sliders, reference image -> estimated
sliders, mobile polish. Not in scope: preset catalogue, strong-match
toggle, undo/redo, before/after, share links, custom domain.

## Roles (agents work on this repo)

### Planner (Codex)
- Reads ROADMAP.md and the current code, then writes tasks/<phase>.md
  for the next unchecked phase. Follows the roadmap scope and
  done-when criteria exactly. Does not add features beyond the roadmap.
- May edit ONLY files under tasks/.

### Builder (Claude Code)
- Implements the task described in the given tasks/*.md file.
- State a short plan before coding. Make small commits on the current
  milestone branch.
- Run available checks (npm install, wrangler deploy --dry-run) before
  finishing.
- Never push, merge, deploy, or touch the main branch. The human does
  that.
- When given a review file (.pipeline/review.md) or a bug report
  (.pipeline/code-bug.md), fix only what it describes (high and medium
  problems only), without adding features.

### Reviewer (Codex)
- Read-only. Never edit files.
- Review the diff against main (git diff main...HEAD) and check:
  bugs, missing input validation, anything bypassing look-schema.js,
  anything that could send user photos to the server, secrets or build
  artifacts in the diff, features outside Phase 1 scope, and Cloudflare
  or Hono usage that disagrees with current official docs.
- Output a list of problems by severity (high, medium, low).
- If there are no high or medium problems, the final line of the reply
  must be exactly: LGTM
- Otherwise do NOT write LGTM anywhere in the reply.

### Test-spec writer (Claude Code)
- After a phase passes review, writes .pipeline/test-spec.md: concrete
  behaviours, edge cases and failure cases to test, mapped to the
  phase's done-when criteria. No code.

### Test writer (Codex)
- Writes automated tests under tests/ (Playwright for browser
  behaviour, node:test for pure logic) covering every item in the
  test spec.
- May edit only tests/, package.json, package-lock.json and
  playwright.config.*. Never edits app code under apps/.
- On a test failure (given .pipeline/test-output.txt): decide whether
  the test or the app is wrong. If the test, fix the test. If the app,
  write the explanation to .pipeline/code-bug.md and change nothing
  else.

## Workflow
- One branch per phase (named after the phase id). Small commits.
- Flow: Planner writes the plan -> human approves by running the phase
  -> Builder implements -> Reviewer checks (Builder fixes, max 2 rounds)
  -> Test-spec writer -> Test writer -> npm test (fix loop, max 2
  rounds) -> Planner writes the next plan -> STOP and wait for the human.
- Agents never push, merge or deploy. The human tests in the browser,
  pushes, merges and deploys.
- Agents never start the next phase on their own.
- When unsure about Cloudflare or Hono APIs, check current official
  docs rather than relying on memory.