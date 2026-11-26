// Shared editor steps: open the page, read the schema, upload, move sliders,
// download. Slider names, ranges and labels always come from the schema.
import { readFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import { encodePng, decodePng } from './images.mjs';

// Every test fails if the page throws an uncaught error at any point.
export const test = base.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
    expect(errors, 'uncaught page errors').toEqual([]);
  }, { auto: true }],
});
export { expect };

// Opens the editor and waits until it has started. If WebGL2 does not work,
// fails with the editor's message and what the browser reports, instead of
// letting later steps time out.
export async function openEditor(page) {
  await page.goto('/');
  // editor.js builds the sliders first, then creates the renderer.
  await expect(page.locator('#sliders input[type="range"]').first()).toBeAttached();
  const status = page.locator('#status');
  if (await status.evaluate((el) => el.classList.contains('error'))) {
    const gl = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('webgl2');
      if (!ctx) return 'getContext("webgl2") returned null';
      const info = ctx.getExtension('WEBGL_debug_renderer_info');
      return `WebGL2 renderer: ${info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'}`;
    });
    throw new Error(`Editor could not start: "${await status.textContent()}". ${gl}. `
      + 'WebGL2 is required; check the Chromium launch flags in playwright.config.mjs.');
  }
}

// The look schema, imported by the page itself (plain data only).
export async function getSchema(page) {
  return page.evaluate(async () => {
    const schema = await import('/shared/look-schema.js');
    return {
      SLIDERS: schema.SLIDERS.map((s) => ({ ...s })),
      BANDS: schema.BANDS.map((b) => ({ ...b })),
      CHANNELS: [...schema.CHANNELS],
      DEFAULTS: { ...schema.DEFAULTS },
    };
  });
}

export const findByEffect = (schema, effect) => {
  const slider = schema.SLIDERS.find((s) => s.effect === effect);
  if (!slider) throw new Error(`No slider with effect "${effect}" in the schema`);
  return slider;
};

export const findBandSlider = (schema, band, channel) => {
  const slider = schema.SLIDERS.find((s) => s.band === band && s.channel === channel);
  if (!slider) throw new Error(`No ${band} ${channel} slider in the schema`);
  return slider;
};

// Rounds a value to the slider's step and keeps it in range.
export function snap(slider, value) {
  const steps = Math.round((value - slider.min) / slider.step);
  const snapped = slider.min + steps * slider.step;
  return Math.min(slider.max, Math.max(slider.min, Number(snapped.toFixed(6))));
}

// Encodes `image` as PNG and opens it through #file, then waits for the
// editor to report the photo as open.
export async function uploadImage(page, image, name = 'synthetic.png') {
  const buffer = await encodePng(page, image);
  await page.locator('#file').setInputFiles({ name, mimeType: 'image/png', buffer });
  await expectPhotoOpen(page, name, image);
  return buffer;
}

export async function expectPhotoOpen(page, name, image) {
  await expect(page.locator('#status')).toHaveText(`${name} (${image.width} x ${image.height})`);
  await expect(page.locator('#download')).toBeEnabled();
  // Sliders are disabled through their <fieldset>; check a real control.
  await expect(page.locator('#panel input[type="range"]').first()).toBeEnabled();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The range input for a schema slider. Band sliders live in a <details>
// per band, which is opened so the input can be used.
export async function sliderInput(page, schema, slider) {
  // A row is <label>Label<input><output>value</output></label>.
  const rowText = new RegExp(`^${escapeRegExp(slider.label)}-?[\\d.]*$`);
  if (!slider.band) {
    return page.locator('#sliders section > label.row').filter({ hasText: rowText })
      .locator('input[type="range"]');
  }
  const band = schema.BANDS.find((b) => b.name === slider.band);
  const details = page.locator('#sliders details').filter({
    has: page.locator('summary', { hasText: new RegExp(`^${escapeRegExp(band.label)}$`) }),
  });
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
  return details.locator('label.row').filter({ hasText: rowText }).locator('input[type="range"]');
}

// Moves a slider like a user would: the value is set on the range input and
// real input/change events are dispatched, so editor.js reacts as usual.
export async function setSlider(page, schema, slider, value) {
  const input = await sliderInput(page, schema, slider);
  await expect(input).toHaveCount(1);
  await input.fill(String(value));
  await expect(input).toHaveValue(String(value));
}

// Downloads the current photo as PNG and decodes it back to pixels.
export async function downloadPng(page) {
  await page.locator('#format').selectOption('image/png');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const buffer = await readFile(await download.path());
  await expect(page.locator('#status')).toHaveText('Photo downloaded.');
  return decodePng(page, buffer);
}
