# Roadmap (Phase 1)

## Phase list (the pipeline reads this; do not change the format)
- [x] m2b-tests — Test setup and M2 regression tests
- [x] m3-ai-prompt — Text prompt sets sliders via Workers AI
- [x] m4a-stats — Image statistics (browser)
- [ ] m4b-match — Reference matching: estimate sliders
- [ ] m5-polish — Mobile layout, errors, launch polish

## m2b-tests
Goal: automated tests exist, so later phases can be verified.
- Playwright installed; `npm test` runs all tests (Playwright config
  starts `npm run dev` as the web server).
- Test: with the default look, the rendered output matches the original.
- Test: exposure up raises mean brightness; red saturation changes
  reds far more than blues.
- Test: uploading a non-image shows a friendly message, no crash.
- Test: no network request carries image data.

## m3-ai-prompt
Goal: typing "warm and moody" moves the sliders.
- POST /api/look takes {prompt}, calls Workers AI (check current Cloudflare
  docs for model and binding), returns a look validated by validateLook.
- Falls back to keyword matching when the model errors, returns invalid
  JSON, or the limit is hit. Fallback is tested by forcing a failure.
- Prompt capped at 300 characters; per-IP rate limiting.
- Tests: 5,000-char prompt, empty prompt, non-JSON model output, and
  out-of-range values are all handled and clamped.
- UI: prompt box calls setLook(); loading and friendly error states.

## m4a-stats
Goal: stats.js computes image stats; a debug panel shows two images side by side.
- Lab mean/std, luminance percentiles (5/50/95), average saturation,
  per-band (8) saturation and luminance. Image downscaled to ~256px.
- Tests: flat/solid-color image gives no NaN or divide-by-zero; known
  synthetic images give expected values.

## m4b-match
Goal: your photo + a reference photo moves the sliders toward the reference.
- match.js estimates a look from the two stats; conservative, clamped,
  with a strength multiplier (default 0.7). Result goes through setLook().
- Tests (synthetic): a dark reference lowers exposure; a warm reference
  raises temperature; identical images give a near-default look.
- Human check: 8-10 real photo pairs (you do this).

## m5-polish
Goal: a friend can use it on a phone with no help.
- Mobile layout (sliders in a collapsible panel), landing sentence,
  "photos never leave your device" note, empty/error states, favicon, meta tags.
- Tests: tiny image, huge image, non-image file, HEIC shows a friendly message.