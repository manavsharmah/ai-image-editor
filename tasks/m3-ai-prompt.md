# Task: m3-ai-prompt — Text prompt sets sliders via Workers AI

Goal: typing "warm and moody" moves the sliders.

Read `AGENTS.md` and follow the Builder role. State a short plan before
coding, work on the current `m3-ai-prompt` milestone branch, and make small
commits. Never push, merge, deploy, or touch `main`. Stop after this phase.

## Current code

- `apps/api/src/index.js` exports a Hono app with only `GET /api/health`.
- `apps/api/wrangler.jsonc` serves `../web` as static assets and sends
  `/api/*` to the Worker first. There are no AI or rate-limit bindings yet.
- `apps/web/shared/look-schema.js` exports `SLIDERS`, `DEFAULTS`,
  `clampLook()`, and `validateLook()`. Validation accepts nonempty partial
  looks, but rejects unknown keys, non-finite/non-numeric values, and values
  outside the schema limits. Clamping fills defaults and drops unknown keys.
- `apps/web/js/editor.js` exports `setLook()`, which clamps, updates every
  control, and renders. Opening a photo resets the look. Photo loading and
  full-resolution downloads already work locally.
- `npm test` runs Playwright through `playwright.config.mjs`, which starts
  `npm run dev`. M2 tests and synthetic image/editor helpers are in `tests/`.
  The privacy regression currently permits only known static GET requests
  during manual editing.

## Files and scope

- `apps/api/wrangler.jsonc`: AI and per-IP rate-limit bindings.
- `apps/api/src/index.js`: register `POST /api/look`; retain the health route.
- `apps/api/src/look.js` (new): request handling, model call, validation,
  and fallback orchestration. Keep helpers exported where useful for tests.
- `apps/api/src/keyword-look.js` (new): small deterministic keyword matcher.
- `apps/web/index.html`: labelled prompt form, submit button, status text.
- `apps/web/js/editor.js`: prompt submission and application through `setLook()`.
- `apps/web/css/styles.css`: styles for these controls and states only.
- Reuse `apps/web/shared/look-schema.js` unchanged; import it into Worker
  helpers using `../../web/shared/look-schema.js`. Do not duplicate its rules.
- After review, the Test writer adds `tests/m3-look.test.mjs` for API/pure
  logic and `tests/m3-prompt.spec.mjs` for browser behaviour, reusing existing
  helpers. Root `package.json` may compose node:test and Playwright in
  `npm test`; change `package-lock.json` only if dependencies actually change.
  Update the M2 privacy allowlist only if a necessary static asset is added.

Use vanilla JS and the existing Hono Worker. No renderer changes, image
uploads, image statistics, reference matching, preset catalogue, strength
toggle, undo/redo, before/after, sharing, custom domain, or M5 layout/launch
polish. Do not change the roadmap, pipeline, or earlier task files. Do not
add a database, another Worker, an AI SDK, or a paid service.

## Implementation steps

1. **Configure Workers AI and rate limiting using current documentation.**
   Add `ai: { binding: "AI" }` to Wrangler and call `c.env.AI.run()` on the
   server. This is the documented [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/).
   Select one currently available text-generation model from the
   [model catalogue](https://developers.cloudflare.com/workers-ai/models/),
   checking its model page for the exact ID, input options, response shape,
   and deprecation status. Do not copy an old model ID blindly: the
   [Llama 3.2 3B page](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)
   is marked deprecated as of this plan's documentation check (2026-11-26).
   Record the selected model and its documentation URL in a short server
   comment. Use only a model available without payment on Workers Free;
   the [pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/)
   documents a free daily allocation and errors when that allocation is
   exhausted. Do not upgrade plans or enable paid overages.

   Add a `ratelimits` entry named `LOOK_RATE_LIMITER`, with an account-unique
   integer-string `namespace_id` and `simple: { limit: 10, period: 60 }`.
   Use `env.LOOK_RATE_LIMITER.limit({ key })` per the
   [Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
   Key by the route plus Cloudflare's `CF-Connecting-IP`, not a body field or
   `X-Forwarded-For`; use a fixed shared key when the header is absent in local
   development. Document that this binding's limits are approximate and
   local to each Cloudflare location. Preserve existing static asset routing.

2. **Define and validate the text-only API contract.** Accept a JSON object
   containing only a string `prompt`. Reject malformed JSON, wrong content
   type, arrays/null, missing or non-string prompts, and extra fields with a
   friendly JSON error and a suitable 4xx status. Trim whitespace, reject an
   empty result with 400, and truncate the remaining prompt to 300 characters
   before either inference or keyword matching. A direct 5,000-character
   prompt must therefore never reach the model unbounded. Do not accept
   multipart files or image fields, fetch user-supplied URLs, or send photo
   bytes, metadata, thumbnails, or canvas data from the client.

   Return successful AI or fallback results as
   `{ look, source: "ai" | "fallback" }`. Every returned look must be complete,
   clamped, and pass `validateLook()`. Errors without a usable look use
   `{ error: "friendly message" }`. Do not expose raw model output, exception
   details, or credentials to the client.

3. **Gate inference and implement the model call.** Check the per-IP limiter
   before invoking AI. On denial, do not invoke AI: return HTTP 429 with a
   clamped keyword look, `source: "fallback"`, a friendly message, and
   `Retry-After: 60`. The UI must explicitly handle this usable fallback body.
   If the limiter is missing or throws, skip inference and use fallback
   rather than making an unrestricted model call.

   Build system instructions from `SLIDERS` (names, labels, effects/bands,
   defaults and ranges). Ask for a flat JSON object of numeric slider values
   describing tone/color adjustments only, with omitted sliders meaning
   defaults. Keep user text in a separate user message. Do not hardcode a
   second slider list or range table. Use a bounded output token count,
   non-streaming output, and only options supported by the selected model.
   Make one inference attempt; do not retry quota failures. Bound the wait
   for inference so the request can fall back instead of loading indefinitely.

4. **Validate untrusted output and provide keyword fallback.** Extract the
   documented model response field and parse JSON without executing it.
   Validate the parsed look before clamping: otherwise `clampLook()` would
   disguise malformed output as a valid neutral look. If it fails validation
   for any reason, including out-of-range numbers, discard it and use keyword
   matching. For accepted AI output, apply `clampLook()` and validate the
   complete result again before returning it.

   Use fallback for model exceptions, timeouts, missing bindings, quota/limit
   errors, non-JSON output, and invalid look objects. Implement a small
   case-insensitive whole-word matcher for warm/cool, bright/dark, moody,
   and muted/vibrant. Compose matching adjustments deterministically from
   `DEFAULTS`; "warm and moody" must increase warmth and darken the look.
   Resolve sliders by schema `effect` metadata and calculate conservative
   amounts as fractions of each slider's default-to-bound distance. Never
   hardcode slider names or limits. With no recognized keywords, return
   defaults. Always clamp the computed fallback and validate it. This is
   an internal fallback, not a user-facing preset catalogue.

5. **Connect the prompt UI to the existing editor.** Add a visible label,
   input/textarea with `maxlength="300"`, an Apply button, and an accessible
   prompt status region. Keep submission disabled until a photo is ready.
   Submit only `{ prompt }` to same-origin `/api/look` on form submission,
   not on every keystroke. Reject whitespace-only input locally and show
   loading feedback while preventing duplicate submissions.

   Validate the response look in the browser and call the existing
   `setLook()` for both AI and fallback success, including the documented
   429 fallback. Display a short fallback notice when applicable. For network
   errors, unusable JSON/responses, or other HTTP errors, keep the existing
   look and show a friendly message. Restore the submit state on every path.
   Ignore or abort stale responses after another photo opens, the look is
   reset/manually changed, or a newer submission supersedes the request.
   Preserve manual fine-tuning and download behaviour. Update the editor's
   outdated comment saying it makes no network requests: only prompts now
   leave the browser. Render messages as text, never model-supplied HTML.

6. **Support deterministic verification and the normal test handoff.**
   Keep production handlers callable with injected environment bindings.
   The [Hono testing API](https://hono.dev/docs/api/hono#request) allows tests
   to exercise the real route with fake AI and limiter bindings. Do not add
   a public failure switch or test-only endpoint. After Builder review, the
   Test-spec writer maps the following to `.pipeline/test-spec.md`; the Test
   writer implements coverage within its allowed files:

   - Valid partial model JSON becomes a complete, validated look. Assert
     the model receives schema-derived instructions and only capped text.
   - A 5,000-character prompt is truncated to 300; empty/whitespace prompts
     and invalid request bodies return friendly errors without invoking AI.
   - Force AI rejection/quota errors, non-JSON output, invalid objects/keys/
     types, and out-of-range values. Assert the real fallback runs and every
     returned value is finite and within schema limits. Invalid model values
     must not be silently accepted by clamping first. Also check that the
     clamp used by the path bounds excessive numeric values at schema limits.
   - "Warm and moody" fallback changes warmth and brightness in the intended
     directions; an unrecognized prompt yields defaults. Derive assertions
     from schema metadata instead of duplicating slider names/ranges.
   - Limiter denial returns 429 plus a valid fallback and makes zero AI calls;
     different IPs produce different keys. Missing/erroring bindings remain
     usable through fallback. Simulate timeouts without real long waits.
   - Browser submission updates controls and preview through `setLook()`;
     users can fine-tune afterwards. Cover loading, duplicate prevention,
     fallback notices, request/response failures, recovery and stale results.
     Use synthetic local photos and deterministic API responses for UI tests;
     separately test the real server handler so browser mocks cannot hide
     validation or fallback bugs.
   - Observe network traffic throughout a prompt/edit/download flow. Permit
     the exact same-origin JSON `{ prompt }` request and known static GETs;
     reject image bytes/base64, photo metadata, extra fields, and unexpected
     destinations. Retain the existing M2 no-upload assertions.

   Tests must not need Cloudflare credentials, live inference, or paid quota.
   Keep node:test files distinct from Playwright's `*.spec.mjs` discovery and
   ensure `npm test` runs both suites. Keep generated artifacts under ignored
   `.pipeline/` paths. Run `npm install`, `npm test`, and
   `npm exec --workspace @ai-image-editor/api -- wrangler deploy --dry-run`.
   Report actual outcomes and environment blockers. Check the live "warm and
   moody" flow only when an existing free-tier binding is available; never
   claim mocked tests prove a live model call. Do not deploy to perform checks.

## Done when

- POST /api/look takes {prompt}, calls Workers AI (check current Cloudflare
  docs for model and binding), returns a look validated by validateLook.
- Falls back to keyword matching when the model errors, returns invalid
  JSON, or the limit is hit. Fallback is tested by forcing a failure.
- Prompt capped at 300 characters; per-IP rate limiting.
- Tests: 5,000-char prompt, empty prompt, non-JSON model output, and
  out-of-range values are all handled and clamped.
- UI: prompt box calls setLook(); loading and friendly error states.
