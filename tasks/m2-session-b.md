# Task: M2 Session B - the real editor interface

Build the real editor UI on apps/web/index.html (replace the "coming
soon" placeholder). Reuse the existing renderer in apps/web/js/renderer.js
and the schema in apps/web/shared/look-schema.js. Do not duplicate or
rewrite them. Vanilla HTML/CSS/JS only.

## Features
1. Image upload: click-to-choose and drag-and-drop. Accept only image
   files (JPG, PNG, WebP). For anything else (including HEIC), show a
   friendly message instead of crashing.
2. Canvas preview that fits the screen while keeping the aspect ratio.
   Large photos (12MP+) must stay smooth while dragging sliders.
3. Slider panel generated entirely from look-schema.js. Do not hardcode
   any slider name, range or default. Group them: Light (exposure,
   contrast, highlights, shadows, whites, blacks), Color (temperature,
   tint, vibrance, saturation), and HSL (a section per color band with
   hue, saturation, luminance). Show each slider's current value.
4. Reset button (all sliders back to defaults). Double-clicking a single
   slider resets only that slider.
5. Download as JPG or PNG at the ORIGINAL full resolution with the look
   applied. Use the renderer's full-resolution export path, not a
   screenshot of the preview.
6. Expose a single function, setLook(look), that applies a look object
   (clamped via clampLook) and updates the sliders and preview. Later
   tasks (AI prompt, reference matching) will call it.
7. Photos never leave the browser. No network requests with image data.
8. Free GPU memory properly when a new image is loaded.

## Layout
Simple, clean, usable on desktop: preview on the left, slider panel on
the right. Keep the CSS in apps/web/css/styles.css. Do full mobile
polish later, but don't make it unusable on a narrow screen.

## Cleanup
Once the real UI works, delete apps/web/test.html.

## Done when
- npm run dev serves the editor at / and a photo can be uploaded,
  edited and downloaded at full resolution
- With all sliders at default, the exported image matches the original
- The sliders panel contains no hardcoded slider names
- wrangler deploy --dry-run still passes
- Work is committed on the current branch (no push, no deploy)