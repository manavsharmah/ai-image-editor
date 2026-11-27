# Task: m4b-match — Reference matching: estimate sliders

Goal: your photo + a reference photo moves the sliders toward the reference.

Read `AGENTS.md` and follow the Builder role. State a short plan before
coding, work on the current `m4b-match` milestone branch, and make small
commits. Never push, merge, deploy, or touch `main`. Stop after this phase.

## Current code

- `apps/web/js/stats.js` exports pure `computeStats()` and synchronous
  browser `sampleImage()`. Samples have a longest side of at most 256px,
  composite transparency onto white, and contain Lab mean/std, linear-light
  luminance p5/p50/p95, HSL saturation, and schema-derived band measurements
  with sample weights. Reuse this contract and its full-precision numbers.
- `apps/web/js/stats-debug.js` loads the reference with `checkPhoto()`,
  ignores superseded loads, closes reference bitmaps, and displays sampled
  canvases/statistics. `showSource(bitmap)` samples the editor-owned source
  synchronously without closing it. Neither function currently exposes the
  measurements for matching.
- `apps/web/js/editor.js` owns the source bitmap and current look.
  `setLook()` clamps, updates every slider/readout, and renders the preview.
  Successful source loading calls `showSource()` and resets the look.
  `cancelPrompt()` prevents delayed AI responses from overwriting newer edits.
- `apps/web/shared/look-schema.js` provides `SLIDERS`, `BANDS`, `CHANNELS`,
  `DEFAULTS`, `clampLook()` and `validateLook()`. Global sliders have stable
  `effect` IDs; band sliders have `band` and `channel` metadata.
- `apps/web/js/renderer.js` applies exposure in stops, warmth as red/blue
  gains, and tint as a green gain adjustment. Other slider values are
  normalized relative to schema defaults and bounds. Statistics' linear Y
  is not the renderer's HSL lightness or encoded-sRGB tone brightness.
- `npm test` runs node:test and Playwright. Existing M4a browser tests expect
  choosing a reference alone to preserve the current photo and look. Privacy
  tests explicitly allow known static module paths.

## Files and scope

- `apps/web/js/match.js` (new): pure statistics-to-look estimator.
- `apps/web/js/stats-debug.js`: retain/expose current measurements and
  reference readiness without duplicating sampling or file loading.
- `apps/web/js/editor.js`: wire the match action to the estimator and
  `setLook()`, including pending-prompt cancellation.
- `apps/web/index.html`: add an explicit `Apply reference` button and local
  status text beside the existing reference chooser in the statistics panel.
- `apps/web/css/styles.css`: only styles needed for the new action/status.
- Reuse `stats.js`, `photo-file.js`, `renderer.js` and `look-schema.js`
  unchanged. No new dependencies or backend changes.
- After review, the Test writer adds `tests/m4b-match.test.mjs` and
  `tests/m4b-match.spec.mjs`, reuses existing image/editor helpers, and adds
  `/js/match.js` to explicit static allowlists in existing privacy tests.

Keep this phase to conservative slider estimation and its application.
Images, pixels, statistics and filenames stay local; matching makes no API
call. Keep the existing text-only AI flow unchanged. Do not add a strength
slider or strong-match toggle, presets, undo/redo, before/after, sharing,
custom domain, content transformations, iterative image optimization, or
M5 mobile/launch work. Do not modify the roadmap, pipeline or earlier tasks.

## Implementation steps

1. **Add a pure estimator with schema-derived output.** Export
   `estimateLook(sourceStats, referenceStats, strength = 0.7)` from
   `match.js`. It must import without a DOM, WebGL or network access and
   return a complete look without mutating its inputs. Start from a copy of
   `DEFAULTS`; resolve output keys through slider `effect`, `band` and
   `channel` metadata. Never duplicate slider names, defaults or ranges.
   Use schema bounds to convert normalized effect amounts into slider
   values. Keep unestimated effects at their defaults.

2. **Implement a small, documented conservative heuristic.** Use differences
   between the unedited source and reference statistics, with zero
   differences yielding zero offsets. Document gains, units, epsilon guards
   and conservative caps beside the calculations; do not claim exact color
   transfer between unrelated scenes.

   - Estimate `lightStops` from a guarded log2 ratio of reference/source
     median linear luminance. Use the same positive floor on both sides so
     identical black inputs remain neutral. Cap the unscaled estimate to a
     conservative fraction of the schema's available stop range.
   - Estimate `warmth` from reference-minus-source Lab mean b (positive is
     warmer), and `magentaShift` from the mean a difference. Scale these
     differences into small normalized effect amounts before converting
     through the schema.
   - Estimate `toneSpread` from relative Lab L spread, guarding flat images
     against division by zero. Estimate `allColor` from average saturation
     differences. Leave unsupported or ambiguous effects at default; the
     task does not require moving every slider.
   - If using per-band saturation/luminance refinements, keep them small,
     derive all band membership from the schema, and require meaningful
     sample weight in both images. Normalize weights by each sample count;
     an absent band is not a measured black/desaturated band. Account for
     the global adjustment so the same difference is not applied twice.
     Do not infer hue shifts from statistics that contain no mean hue, or
     treat relative luminance Y as HSL lightness. Omit these refinements
     rather than adding a second image-processing or optimization pipeline.

3. **Apply strength and guard the result.** Treat strength as an estimator
   argument, defaulting to 0.7, with finite inputs limited to [0, 1]. Reject
   non-finite/non-numeric strength explicitly. Scale each estimated offset
   from its schema default exactly once; zero strength returns `DEFAULTS`.
   Apply conservative limits before strength and final `clampLook()` after
   it, then require `validateLook()` to pass. Validate the measurements used
   before doing arithmetic; malformed/non-finite stats must produce a
   controlled error, never NaN sliders. Guard black images, zero variance
   and empty bands. Preserve small numeric tolerances from `stats.js` rather
   than rejecting valid measurements due to floating-point rounding.

4. **Reuse current samples and make readiness explicit.** Extend
   `stats-debug.js` with a small getter/callback interface for the current
   source/reference stats and readiness; do not read formatted DOM text or
   import the editor back into the debug module. Retain the same samples
   used for the readouts. Clear the source stats if a newly accepted source
   cannot be sampled. While a new reference is loading, disable matching;
   publish only its newest successful result. A failed reference may retain
   the previous valid sample, consistent with the existing failure message.
   Notify readiness changes on success, failure and loading transitions.
   Preserve independent load IDs, input resetting and bitmap cleanup.
   Slider changes must not resample either image.

5. **Apply only on an explicit action.** Add a labelled `Apply reference`
   button (`type="button"`) and a `role="status"` message to the existing
   reference controls, leaving the M4a panel and chooser usable as before.
   The action is disabled until the renderer/source and both valid samples
   are ready, and while source/reference replacement is pending. Recheck
   readiness in its handler. Wire it in `editor.js`: estimate using the
   default strength, cancel any pending prompt before applying a successful
   result, and call `setLook(result)`. Report success or a friendly local
   failure with `textContent`; on failure keep the current look.

   Choosing either image does not automatically apply a match. Source
   replacement keeps the existing default-look reset; reference replacement
   keeps manual settings until Apply is clicked. Match replaces the current
   look with an estimate from the original source, so repeated clicks do
   not compound adjustments. Manual fine-tuning, Reset, AI prompts and
   full-resolution downloads continue to use the same editor state.

6. **Follow the review/test handoff and verify the phase.** After review,
   the Test-spec writer maps the roadmap criteria to the test spec; the
   Test writer implements tests within its permitted files. Cover:

   - Synthetic pixels passed through `computeStats()`: a darker neutral
     reference produces exposure below default; a warm reference produces
     temperature above default; identical images produce a near-default
     complete look. Use schema effect metadata in assertions and independent
     directional expectations, not copies of estimator formulas.
   - Identical black, white, gray and colored images; zero variance, empty
     bands, extreme differences and malformed stats: defined finite,
     validated/clamped results or controlled errors. Strength 0 is neutral,
     omitted strength equals 0.7, and smaller positive strength reduces
     offsets without changing their direction. Inputs remain unchanged.
   - Browser flow through real file inputs and Apply: slider/readout and
     preview changes, repeat application without accumulation, manual edits,
     Reset and download. Missing/failed/pending samples cannot apply stale
     stats; replacements and delayed AI replies cannot overwrite a newer
     match. Preserve existing reference-selection and statistics regressions.
   - Observe requests from navigation through choosing both images and
     applying the match. Allow only explicitly listed same-origin static
     GETs for this flow; no prompt request, photo upload, statistics transfer
     or other outbound image data. Extend existing allowlists narrowly.

   Run `npm install`, `npm test`, and
   `npm exec --workspace @ai-image-editor/api -- wrangler deploy --dry-run`.
   Report actual outcomes and environment blockers; do not deploy. Use the
   existing review and test-failure handoffs rather than weakening tests.

   Leave the roadmap's real-photo check to the human: try 8-10 local source
   and reference pairs, including brighter/darker, warmer/cooler and varied
   scenes. Inspect whether Apply moves the look toward the reference while
   remaining restrained and manually adjustable. Report this check as
   pending until the human performs it; do not upload or commit their photos.

## Done when

- match.js estimates a look from the two stats; conservative, clamped,
  with a strength multiplier (default 0.7). Result goes through setLook().
- Tests (synthetic): a dark reference lowers exposure; a warm reference
  raises temperature; identical images give a near-default look.
- Human check: 8-10 real photo pairs (you do this).
