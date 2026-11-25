# Task: M2 Session A - schema and renderer

First, remove packages/shared and its workspace entry from the root
package.json.

Then create apps/web/shared/look-schema.js:
- Global sliders: exposure, contrast, highlights, shadows, whites,
  blacks, temperature, tint, vibrance, saturation.
- Hue, saturation and luminance sliders for 8 color bands: red, orange,
  yellow, green, aqua, blue, purple, magenta.
- Each slider has min, max and default.
- Export defaults, clampLook() and validateLook().
- Pure JS, no imports.

Then build a WebGL2 renderer in apps/web/js/renderer.js that takes an
image and a look object and renders it in real time.
- Preview at a reduced size so large photos (12MP+) stay smooth. Render
  at full resolution only when exporting.
- All slider names and ranges must come from look-schema.js. Do not
  hardcode them in the renderer.

Add a temporary test page (apps/web/test.html) that loads a sample image
and shows a few sliders, so I can check that each slider does what its
name says.

Keep it simple and explain the shader math in short comments.

## Done when
- npm run dev serves the test page and the sliders change the image
- wrangler deploy --dry-run still passes
- Work is committed on the current branch (no push, no deploy)