# Task: m4a-stats — Image statistics (browser)

Goal: stats.js computes image stats; a debug panel shows two images side by side.

Read `AGENTS.md` and follow the Builder role. State a short plan before
coding, work on the current `m4a-stats` milestone branch, and make small
commits. Never push, merge, deploy, or touch `main`. Stop after this phase.

## Current code

- `apps/web/js/editor.js` owns the source `ImageBitmap`, validates files with
  `checkPhoto()`, ignores stale loads using `latestLoad`, and closes replaced
  bitmaps. Opening a source photo resets the look through `setLook()`.
- `apps/web/js/renderer.js` makes a separate preview with a longest side of
  1600px and retains the original image for full-resolution export. Statistics
  should read the original decoded image through a separate small 2D canvas,
  not read back the WebGL preview or change rendering/export resolution.
- `apps/web/shared/look-schema.js` exports `BANDS`, including the eight names,
  labels, and hue centers. The renderer blends neighboring hue bands with
  circular, linear weights derived from those centers.
- `apps/web/index.html` has the source chooser, preview, prompt form, sliders,
  and download controls, but no reference input or statistics panel.
- `apps/web/js/photo-file.js` validates JPG/PNG/WebP signatures and provides
  unsupported-file messages. Reuse it for the debug reference input.
- `npm test` runs node:test (`*.test.mjs`) followed by Playwright
  (`*.spec.mjs`). `playwright.config.mjs` starts `npm run dev:local` without
  Cloudflare credentials. Synthetic image helpers already exist under
  `tests/helpers/`; the M2 privacy test permits an explicit set of static GETs.

## Files and scope

- `apps/web/js/stats.js` (new): browser sampling wrapper and pure pixel
  statistics, with documented units and an exported result contract.
- `apps/web/js/stats-debug.js` (new): debug panel rendering, reference file
  loading, and its local resource lifecycle.
- `apps/web/js/editor.js`: initialize the debug panel and pass it successfully
  opened source images for sampling while the bitmap is still valid.
- `apps/web/index.html`: a labelled debug panel with source/reference previews,
  reference file input, statistics readouts, and local status messages.
- `apps/web/css/styles.css`: narrowly scoped debug panel styles.
- Reuse `apps/web/shared/look-schema.js`, `apps/web/js/photo-file.js`, and
  `apps/web/js/renderer.js` unchanged.
- After review, the Test writer adds `tests/m4a-stats.test.mjs` and
  `tests/m4a-stats.spec.mjs`, reuses or extends `tests/helpers/images.mjs`, and
  updates `tests/m2-privacy.spec.mjs` only for the new static module paths.
  Existing test scripts and configuration should already discover these files.

Use vanilla JS and browser APIs without new dependencies. Keep images,
pixels, statistics, and filenames local; the existing text-only prompt API
stays unchanged. Do not modify `apps/api/`, the roadmap, pipeline, or earlier
task files. No `match.js`, slider estimation/application from statistics,
strength control, preset catalogue, undo/redo, before/after, sharing, custom
domain, or M5 mobile/launch work. The two debug images are the source photo
and reference photo, not original-versus-edited views.

## Implementation steps

1. **Define a small, testable statistics API.** Export a pure function such
   as `computeStats({ width, height, data })` accepting sRGB RGBA bytes, plus
   a browser wrapper such as `sampleImage(image)` that returns the sampled
   canvas and its stats. Keep DOM access inside the wrapper so importing the
   module and exercising the math under node:test needs no DOM or WebGL.
   Use one documented result shape: sample dimensions/count, Lab mean and
   population standard deviation for L/a/b, luminance p5/p50/p95, average
   saturation, and per-band saturation/luminance plus effective sample
   weight. Generate band keys and display labels from `BANDS`; do not copy
   its names, order, or hue centers into another list. These measurements
   are not slider values and must not be passed through `clampLook()`.

2. **Downsample locally before reading pixels.** Fit the longest side to
   256px, preserve aspect ratio, round dimensions to at least one pixel,
   and never enlarge smaller images. Draw into a small sRGB 2D canvas and
   read only that canvas's pixels. Sample the unedited source bitmap and
   the independently decoded reference through the same path. Do not allocate
   a full-resolution pixel buffer or resample on every slider movement.
   Establish a single alpha policy: composite onto opaque white before
   calculating statistics, using the same composite in the debug thumbnail.
   Apply equivalent compositing when the pure function receives transparent
   RGBA input directly, so hidden RGB values cannot skew the measurements.

3. **Compute the requested measurements with explicit conventions.**
   Convert normalized sRGB to linear RGB, then XYZ and CIELAB using the D65
   white point and the standard piecewise Lab conversion. Calculate means
   and population standard deviations using a numerically stable method;
   guard tiny negative variance from floating-point rounding before square
   roots. Define luminance as linear-light relative Y in [0, 1], and compute
   p5/p50/p95 from sorted samples with linear interpolation at `(n - 1) * p`.
   Define saturation as HSL saturation of sRGB in [0, 1]; handle black,
   white, and zero-chroma pixels explicitly. Use this convention for both
   global and per-band saturation, and the same relative Y for global and
   per-band luminance. Document that HSL lightness and relative luminance
   are different quantities.

   Derive circular interpolation weights between adjacent hue centers from
   `BANDS`, matching the renderer's band-center convention including the
   wrap through red. Accumulate weighted saturation and luminance in all
   eight bands. Achromatic pixels contribute to global measurements but
   have no hue-band membership. Return zero weight and finite zero means
   for empty bands; the UI should show these as no samples rather than
   implying a measured black band. Never divide by zero. Reject malformed
   or zero-size pixel buffers with a clear error instead of returning NaN.

4. **Add the debug panel and connect source/reference loading.** Use a
   simple labelled `details` panel outside the disabled adjustments
   fieldset. Show two columns with the sampled source and reference images
   side by side, sample dimensions, Lab mean/std, luminance percentiles,
   average saturation, and a compact band table generated from `BANDS`.
   Format only for display; retain full precision in returned stats. Give
   unloaded slots an explicit empty state and display text via `textContent`.
   Scope layout styles to this panel and keep its content accessible by
   scrolling without covering the existing preview or controls.

   Feed the source slot from the existing successful `openPhoto()` path.
   Keep sampling synchronous while using its borrowed bitmap, or otherwise
   explicitly protect its lifetime and ignore superseded results. The
   debug module must never close the editor-owned source bitmap. Use a
   dedicated local file chooser for the reference, with `checkPhoto()` and
   `createImageBitmap()`. Keep separate reference load IDs so older results
   cannot replace newer selections. Reset the input so a file can be selected
   again; close temporary reference bitmaps after sampling and on failure or
   supersession. Retain only the small reference canvas/stats once sampled.
   Reference changes must not replace the editor photo or reset its sliders.

   Report validation, decoding, or sampling failures inside the debug
   panel, with no uncaught rejection or disruption of normal editing and
   downloads. Keep previews and readouts paired: if sampling a newly accepted
   source fails, clear its old debug result rather than showing stale stats.
   An invalid reference selection may retain the previous valid reference
   with a clear failure message. Do not add remote image URLs or uploads.

5. **Follow the review and test handoff.** After review, the Test-spec writer
   maps the roadmap criteria to `.pipeline/test-spec.md`; the Test writer
   implements the automated checks in its permitted files. Cover:

   - Opaque solid black, white, gray, and saturated-color buffers: all
     results finite, Lab standard deviations zero within numeric tolerance,
     equal luminance percentiles, and safe empty-band results.
   - Independently derived expected values: black/white Lab endpoints,
     zero gray saturation, known primary-color Lab values, and an equal
     black/white fixture with Lab L mean/std of 50 and luminance p5/p50/p95
     of 0/0.5/1 under the stated percentile rule. Use small fixtures that
     bypass resampling and documented tolerances; do not generate expected
     values by calling the production conversions.
   - Synthetic hue patches at schema band centers and between centers,
     including red wraparound: correct weighted membership, saturation,
     luminance, and no fabricated hue membership for gray pixels. Include
     transparency and malformed-buffer checks for the defined contract.
   - Browser sampling of a known solid image larger than 256px: bounded
     dimensions, preserved aspect ratio, and matching expected statistics;
     a smaller image is not enlarged. Source and reference previews/readouts
     update independently, handle replacement and failed loads, and remain
     tied to unedited images when sliders change.
   - Observe network traffic while opening both local images and displaying
     stats. Permit only known same-origin static GETs for this flow, adding
     the two new module paths explicitly; reject uploads or image/statistics
     data in requests. Preserve existing editing/download regression tests
     and privacy assertions rather than broadening their allowlist generally.

   Run `npm install`, `npm test`, and
   `npm exec --workspace @ai-image-editor/api -- wrangler deploy --dry-run`.
   Report actual outcomes and environment blockers. Do not deploy. Keep
   fixtures under `tests/` and generated outputs in existing ignored paths.
   On an app failure, use the existing `.pipeline/code-bug.md` handoff; the
   Test writer must not edit app code or weaken correct assertions.

## Done when

- Lab mean/std, luminance percentiles (5/50/95), average saturation,
  per-band (8) saturation and luminance. Image downscaled to ~256px.
- Tests: flat/solid-color image gives no NaN or divide-by-zero; known
  synthetic images give expected values.
