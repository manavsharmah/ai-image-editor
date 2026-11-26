// M2 rendering regressions: the default look leaves the photo unchanged,
// exposure brightens, and red saturation affects reds far more than blues.
import {
  asymmetricImage, midtoneImage, patchesImage, RED_RECT, BLUE_RECT,
  meanBrightness, meanAbsRgbChange, meanChannelSpread, compareRgb,
} from './helpers/images.mjs';
import {
  test, expect, openEditor, getSchema, findByEffect, findBandSlider, snap,
  uploadImage, setSlider, downloadPng, expectLook,
} from './helpers/editor.mjs';

// GPU rounding (sRGB <-> linear in floats, then back to 8 bits) may move a
// channel by a level or two. Anything more is a real change.
const ROUNDING = 2;

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('default look downloads the original pixels', async ({ page }) => {
  const source = asymmetricImage();
  await uploadImage(page, source);
  await expectLook(page, await getSchema(page));
  const output = await downloadPng(page);

  expect([output.width, output.height]).toEqual([source.width, source.height]);
  const { maxDiff, worst, minAlpha } = compareRgb(source, output);
  expect(maxDiff, `worst pixel: ${JSON.stringify(worst)}`).toBeLessThanOrEqual(ROUNDING);
  expect(minAlpha).toBe(255);

  // Explicit checks on distinct regions, so a flip cannot pass by accident.
  const at = (image, x, y) => Array.from(image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= ROUNDING);
  for (const [x, y] of [[2, 2], [60, 44], [40, 4], [40, 44], [10, 24]]) {
    expect(close(at(output, x, y), at(source, x, y)), `pixel ${x},${y}`).toBe(true);
  }
  expect(close(at(output, 2, 2), at(source, 2, 44))).toBe(false); // top differs from bottom
});

test('opening another photo resets every changed slider to its schema default', async ({ page }) => {
  const schema = await getSchema(page);
  await uploadImage(page, asymmetricImage(), 'first.png');
  for (const slider of schema.SLIDERS) {
    const direction = slider.default < slider.max ? 1 : -1;
    const value = snap(slider, slider.default + direction * slider.step);
    expect(value).not.toBe(slider.default);
    await setSlider(page, schema, slider, value);
  }
  await uploadImage(page, midtoneImage(), 'replacement.png');
  await expectLook(page, schema);
});

test('exposure up raises mean brightness', async ({ page }) => {
  const schema = await getSchema(page);
  const exposure = findByEffect(schema, 'lightStops');
  // One fifth of the way from default to max (+1 stop with the current schema).
  const value = snap(exposure, exposure.default + (exposure.max - exposure.default) / 5);
  expect(value).toBeGreaterThan(exposure.default);
  expect(value).toBeLessThanOrEqual(exposure.max);

  const source = midtoneImage();
  await uploadImage(page, source);
  const before = await downloadPng(page);
  await setSlider(page, schema, exposure, value);
  await expectLook(page, schema, { [exposure.name]: value });
  const after = await downloadPng(page);
  for (const output of [before, after]) {
    expect([output.width, output.height]).toEqual([source.width, source.height]);
    expect(compareRgb(source, output).minAlpha).toBe(255);
  }

  // +1 stop on a ~116 gray is about +40 levels; require at least 15 so the
  // test catches exposure that barely works or goes the wrong way.
  const gain = meanBrightness(after) - meanBrightness(before);
  expect(gain).toBeGreaterThanOrEqual(15);
});

test('lowering red saturation changes reds far more than blues', async ({ page }) => {
  const schema = await getSchema(page);
  const redSaturation = findBandSlider(schema, 'red', 'Saturation');
  const value = redSaturation.min;
  expect(value).toBeLessThan(redSaturation.default);

  await uploadImage(page, patchesImage());
  const before = await downloadPng(page);
  await setSlider(page, schema, redSaturation, value);
  await expectLook(page, schema, { [redSaturation.name]: value });
  const after = await downloadPng(page);
  expect([after.width, after.height]).toEqual([before.width, before.height]);

  const red = meanAbsRgbChange(before, after, RED_RECT);
  const blue = meanAbsRgbChange(before, after, BLUE_RECT);
  // Red at minimum saturation moves (200, 80, 80) toward gray: ~60 levels.
  expect(red, 'red patch change').toBeGreaterThanOrEqual(10);
  expect(blue, 'blue patch change').toBeLessThanOrEqual(ROUNDING);
  // Floor of 1 level so a blue change of ~0 does not divide by zero.
  expect(red / Math.max(blue, 1), 'red / blue change').toBeGreaterThanOrEqual(5);
  expect(meanChannelSpread(after, RED_RECT), 'red moves toward gray')
    .toBeLessThan(meanChannelSpread(before, RED_RECT));
});
