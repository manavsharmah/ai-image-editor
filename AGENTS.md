# Project: AI Photo Look Editor

A free, browser-based photo editor. The user uploads a photo; AI or a
reference image sets color sliders; the user fine-tunes and downloads.
It never transforms content (no background removal, no generative edits).
It only adjusts exposure, tone, color and HSL.

## Structure (monorepo)
- apps/web       static frontend (vanilla HTML/CSS/JS, WebGL2)
- apps/api       Hono API running on a Cloudflare Worker
- packages/shared  look-schema.js (single source of truth for sliders)

## Hard rules
1. Vanilla HTML/CSS/JS only. No frontend frameworks or build-heavy tooling.
2. Backend is Hono on ONE Cloudflare Worker; static files served via
   Workers static assets.
3. Photos are processed only in the browser and never uploaded. The server
   only ever receives text prompts.
4. Every slider value goes through packages/shared/look-schema.js
   (names, min, max, default, clampLook(), validateLook()). Never
   hardcode slider names or ranges elsewhere. The UI is generated from it.
5. All AI output is untrusted: validate, clamp, and fall back to keyword
   matching if it is invalid.
6. Stay on the free tier. No paid services, no payment-required features.
7. Keep it simple. Prefer small readable files and short comments on
   anything non-obvious.

## Workflow
- One branch per milestone (m1-foundation, m2-editor, ...).
- Make small commits. Never commit secrets, .env or .dev.vars files.
- Before writing code for a task, state the plan briefly.
- When unsure about Cloudflare or Hono APIs, check current official docs
  rather than relying on memory.

## Phase 1 scope (do NOT build beyond this)
Manual sliders, text prompt -> AI sliders, reference image -> estimated
sliders, mobile polish. Not in scope: preset catalogue, strong-match
toggle, undo/redo, before/after, share links, custom domain.