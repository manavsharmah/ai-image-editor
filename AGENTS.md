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

## Roles (two agents work on this repo)

### Builder (Claude Code)
- Implements the task described in the given tasks/*.md file.
- State a short plan before coding. Make small commits on the current
  milestone branch.
- Run available checks (npm install, wrangler deploy --dry-run) before
  finishing.
- Never push, merge, deploy, or touch the main branch. The pipeline
  script does that.
- When given a review file, fix high and medium problems only, without
  adding features.

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

## Workflow
- One branch per milestone (m2-editor, m3-ai-prompt, ...). Small commits.
- Flow: Builder implements -> Reviewer checks -> (Builder fixes,
  max 2 rounds) -> pipeline pushes the branch -> optional merge and
  deploy to production -> health check.
- When unsure about Cloudflare or Hono APIs, check current official docs
  rather than relying on memory.