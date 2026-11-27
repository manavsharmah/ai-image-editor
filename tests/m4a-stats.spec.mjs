import { BANDS } from '../apps/web/shared/look-schema.js';
import { solidImage, encodePng, compareRgb } from './helpers/images.mjs';
import { near, finite, referenceColor, expectedWeights, expectedSize } from './helpers/stats-reference.mjs';
import {
  test, expect, openEditor, getSchema, findByEffect, snap, uploadImage,
  setSlider, expectLook, downloadPng,
} from './helpers/editor.mjs';

const slot = (page, name) => page.locator(`#stats-${name}`);
const readout = (page, name, label) => slot(page, name).locator('dt')
  .filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
const numbers = async (locator) => (await locator.textContent()).split('/').map(Number);
const bodyText = (page, name) => slot(page, name).locator('.stats-body').textContent();
const thumb = (page, name) => slot(page, name).locator('canvas').evaluate((canvas) => canvas.toDataURL());
const sliders = (page) => page.locator('#sliders input').evaluateAll((inputs) => inputs.map((input) => input.value));
const preview = (page) => page.locator('#view').screenshot();

async function openPanel(page) {
  await page.getByText('Image statistics (debug)', { exact: true }).click();
  await expect(page.locator('#choose-reference')).toBeVisible();
}

async function referenceFile(page, image, name = 'reference.png') {
  return { name, mimeType: 'image/png', buffer: await encodePng(page, image) };
}

async function loadReference(page, image, name) {
  await page.locator('#reference-file').setInputFiles(await referenceFile(page, image, name));
  const size = expectedSize(image.width, image.height);
  await expect(readout(page, 'reference', 'Sample')).toHaveText(`${size.width} x ${size.height}`);
  await expect(slot(page, 'reference').locator('.stats-msg')).toHaveText('');
}

async function checkSolidReadouts(page, name, rgb) {
  const ref = referenceColor(rgb);
  const lab = await numbers(readout(page, name, 'Lab mean'));
  ['L', 'a', 'b'].forEach((key, i) => near(lab[i], ref.lab[key], 0.5, key));
  expect(await numbers(readout(page, name, 'Lab std'))).toEqual([0, 0, 0]);
  const luminances = await numbers(readout(page, name, 'Lum p5/50/95'));
  luminances.forEach((value) => near(value, ref.Y, 0.005));
  expect(new Set(luminances).size).toBe(1);
  near(Number(await readout(page, name, 'Saturation').textContent()), ref.saturation, 0.005);
}

async function checkBandRows(page, name, rgb, count) {
  const rows = slot(page, name).locator('.stats-bands tr').filter({ has: page.locator('td') });
  await expect(rows).toHaveCount(BANDS.length);
  const ref = referenceColor(rgb), weights = expectedWeights(ref.hue);
  for (let i = 0; i < BANDS.length; i++) {
    await expect(rows.nth(i).locator('th')).toHaveText(BANDS[i].label);
    const cells = rows.nth(i).locator('td');
    if (weights[i] === 0) await expect(cells).toHaveText(['no samples']);
    else {
      await expect(cells).toHaveCount(3);
      const values = (await cells.allTextContents()).map(Number);
      near(values[0], ref.saturation, 0.005);
      near(values[1], ref.Y, 0.005);
      near(values[2], weights[i] * count, 0.051);
    }
  }
}

// H: use the actual file inputs, image decoding, 2D sampling and debug readouts.
test('H1/H2/H5: large solid source is downscaled with accurate readouts and schema bands', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const rgb = [200, 80, 80], image = solidImage(600, 400, rgb);
  await uploadImage(page, image);
  const size = expectedSize(image.width, image.height);
  await expect(readout(page, 'source', 'Sample')).toHaveText(`${size.width} x ${size.height}`);
  expect(await slot(page, 'source').locator('canvas.stats-thumb').evaluate((c) => ({ width: c.width, height: c.height }))).toEqual(size);
  await checkSolidReadouts(page, 'source', rgb);
  await checkBandRows(page, 'source', rgb, size.width * size.height);
  await loadReference(page, solidImage(41, 29, [80, 200, 120]));
  await checkBandRows(page, 'reference', [80, 200, 120], 41 * 29);
});

test('H3/H6: small gray source stays small, has no hue samples or invalid readouts', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  await uploadImage(page, solidImage(40, 30, [128, 128, 128]));
  await expect(readout(page, 'source', 'Sample')).toHaveText('40 x 30');
  await checkSolidReadouts(page, 'source', [128, 128, 128]);
  await checkBandRows(page, 'source', [128, 128, 128], 40 * 30);
  expect(await page.locator('#stats-debug').textContent()).not.toMatch(/NaN|Infinity|(?:^|[^\d])-0(?:\D|$)/);
});

test('H4: direct browser sampling rounds extreme aspect and composites transparent canvas to white', async ({ page }) => {
  await openEditor(page);
  const results = await page.evaluate(async () => {
    const { sampleImage } = await import('/js/stats.js');
    return [false, true].map((transparent) => {
      const source = document.createElement('canvas');
      source.width = 1000; source.height = 10;
      if (!transparent) {
        const ctx = source.getContext('2d');
        ctx.fillStyle = 'rgb(200,80,80)'; ctx.fillRect(0, 0, source.width, source.height);
      }
      const { canvas, stats } = sampleImage(source);
      return { stats, width: canvas.width, height: canvas.height,
        pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) };
    });
  });
  const size = expectedSize(1000, 10);
  for (const result of results) {
    expect({ width: result.width, height: result.height }).toEqual(size);
    expect({ width: result.stats.width, height: result.stats.height }).toEqual(size);
    finite(result.stats);
  }
  near(results[0].stats.lab.mean.L, referenceColor([200, 80, 80]).lab.L, 0.5);
  near(results[1].stats.lab.mean.L, 100, 0.5);
  for (const value of Object.values(results[1].stats.luminance)) near(value, 1, 0.005);
  expect(results[1].stats.saturation).toBe(0);
  for (const value of Object.values(results[1].stats.bands)) expect(value.weight).toBe(0);
  expect(results[1].pixels.every((byte) => byte === 255)).toBe(true);
});

test('I1/I2: panel and reference chooser work before opening a source', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#panel')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#panel input[type="range"]').first()).toBeDisabled();
  await expect(page.locator('#panel #stats-debug')).toHaveCount(0);
  await openPanel(page);
  for (const name of ['source', 'reference']) await expect(slot(page, name).locator('.stats-empty')).toHaveText('No image loaded.');
  await expect(page.locator('#choose-reference')).toBeEnabled();
  const image = solidImage(40, 30, [80, 150, 200]);
  const file = await referenceFile(page, image);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#choose-reference').click();
  await (await chooserPromise).setFiles(file);
  await expect(readout(page, 'reference', 'Sample')).toHaveText('40 x 30');
  await checkSolidReadouts(page, 'reference', [80, 150, 200]);
  await expect(slot(page, 'source').locator('.stats-empty')).toHaveText('No image loaded.');
  await expect(page.locator('#panel')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#panel input[type="range"]').first()).toBeDisabled();
  await expect(page.locator('#download')).toBeDisabled();
});

test('I3/I6: independent slot replacement updates source stats and resets sliders', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const colors = [[180, 70, 60], [50, 90, 200], [90, 170, 60], [150, 60, 170]];
  await uploadImage(page, solidImage(40, 30, colors[0]), 'A.png');
  await loadReference(page, solidImage(41, 31, colors[1]), 'B.png');
  await checkSolidReadouts(page, 'source', colors[0]);
  await checkSolidReadouts(page, 'reference', colors[1]);
  const sourceA = await bodyText(page, 'source'), referenceB = await bodyText(page, 'reference');
  const referenceThumb = await thumb(page, 'reference');
  const schema = await getSchema(page), exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + exposure.step));
  await uploadImage(page, solidImage(42, 32, colors[2]), 'C.png');
  await expectLook(page, schema);
  await checkSolidReadouts(page, 'source', colors[2]);
  expect(await bodyText(page, 'source')).not.toBe(sourceA);
  expect(await bodyText(page, 'reference')).toBe(referenceB);
  expect(await thumb(page, 'reference')).toBe(referenceThumb);
  const sourceC = await bodyText(page, 'source'), sourceThumb = await thumb(page, 'source');
  await loadReference(page, solidImage(43, 33, colors[3]), 'D.png');
  await checkSolidReadouts(page, 'reference', colors[3]);
  expect(await bodyText(page, 'reference')).not.toBe(referenceB);
  expect(await bodyText(page, 'source')).toBe(sourceC);
  expect(await thumb(page, 'source')).toBe(sourceThumb);
});

test('I4/I5: reference preserves the editor and slider edits preserve original-image stats', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  await uploadImage(page, solidImage(64, 48, [180, 70, 60]), 'editor-source.png');
  const schema = await getSchema(page), exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + (exposure.max - exposure.default) / 5));
  const beforeSliders = await sliders(page), beforeStatus = await page.locator('#status').textContent();
  const beforePreview = await preview(page), sourceStats = await bodyText(page, 'source');
  await loadReference(page, solidImage(40, 30, [80, 90, 200]));
  expect(await sliders(page)).toEqual(beforeSliders);
  expect(await page.locator('#status').textContent()).toBe(beforeStatus);
  expect(await preview(page)).toEqual(beforePreview);
  expect(await bodyText(page, 'source')).toBe(sourceStats);
  const referenceStats = await bodyText(page, 'reference');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + (exposure.max - exposure.default) * 2 / 5));
  const band = schema.SLIDERS.find((s) => s.band === BANDS[0].name && s.channel === 'Saturation');
  await setSlider(page, schema, band, band.min);
  expect(await bodyText(page, 'source')).toBe(sourceStats);
  expect(await bodyText(page, 'reference')).toBe(referenceStats);
  expect(await preview(page)).not.toEqual(beforePreview);
});

test('I7: choosing the same reference twice reloads and cycles its status', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const image = solidImage(40, 30, [120, 80, 170]), file = await referenceFile(page, image);
  await page.locator('#reference-file').setInputFiles(file);
  await expect(readout(page, 'reference', 'Sample')).toHaveText('40 x 30');
  await expect(slot(page, 'reference').locator('.stats-msg')).toHaveText('');
  const before = await bodyText(page, 'reference');
  await expect(page.locator('#reference-file')).toHaveValue('');
  // Observe real DOM mutations so even a fast local decode cannot hide loading.
  await page.evaluate(() => {
    const message = document.querySelector('#stats-reference .stats-msg');
    window.referenceMessages = [];
    window.referenceObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) window.referenceMessages.push(node.textContent);
      window.referenceMessages.push(message.textContent);
    });
    window.referenceObserver.observe(message, { childList: true, characterData: true, subtree: true });
    window.previousReferenceCanvas = document.querySelector('#stats-reference canvas');
  });
  await page.locator('#reference-file').setInputFiles(file);
  await expect.poll(() => page.evaluate(() => window.referenceMessages.includes('Reading reference...')
    && window.previousReferenceCanvas !== document.querySelector('#stats-reference canvas')
    && document.querySelector('#stats-reference .stats-msg').textContent === '')).toBe(true);
  expect(await bodyText(page, 'reference')).toBe(before);
  await expect(slot(page, 'reference').locator('.stats-msg')).not.toHaveClass(/error/);
  await page.evaluate(() => window.referenceObserver.disconnect());
});

const invalidReferences = [
  { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
  { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text reference') },
  { name: 'damaged.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]) },
];
for (const file of invalidReferences) test(`I8/I9: ${file.name} retains valid reference and editor still downloads`, async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const image = solidImage(40, 30, [120, 80, 60]);
  await uploadImage(page, image, 'working-source.png');
  await loadReference(page, solidImage(41, 31, [80, 150, 200]));
  const schema = await getSchema(page), exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + exposure.step));
  const before = { source: await bodyText(page, 'source'), reference: await bodyText(page, 'reference'),
    thumbnail: await thumb(page, 'reference'), sliders: await sliders(page), preview: await preview(page),
    status: await page.locator('#status').textContent() };
  await page.locator('#reference-file').setInputFiles(file);
  const message = slot(page, 'reference').locator('.stats-msg.error');
  await expect(message).toBeVisible();
  await expect(message).toContainText(file.name === 'damaged.png' ? /damaged|could not open/i : /not supported/i);
  expect(await bodyText(page, 'reference')).toBe(before.reference);
  expect(await thumb(page, 'reference')).toBe(before.thumbnail);
  expect(await bodyText(page, 'source')).toBe(before.source);
  expect(await sliders(page)).toEqual(before.sliders);
  expect(await preview(page)).toEqual(before.preview);
  expect(await page.locator('#status').textContent()).toBe(before.status);
  await setSlider(page, schema, exposure, exposure.default);
  const output = await downloadPng(page);
  expect([output.width, output.height]).toEqual([image.width, image.height]);
  expect(compareRgb(image, output).maxDiff).toBeLessThanOrEqual(2);
});

test('I10: immediately superseded large reference cannot replace the second file', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const large = await referenceFile(page, solidImage(1400, 1000, [180, 70, 60]), 'large.png');
  const small = await referenceFile(page, solidImage(23, 17, [60, 80, 180]), 'small.png');
  await page.locator('#reference-file').setInputFiles(large);
  await page.locator('#reference-file').setInputFiles(small);
  await expect(readout(page, 'reference', 'Sample')).toHaveText('23 x 17');
  await expect(slot(page, 'reference').locator('.stats-msg')).toHaveText('');
  await checkSolidReadouts(page, 'reference', [60, 80, 180]);
  expect(await slot(page, 'reference').locator('canvas').evaluate((c) => [c.width, c.height])).toEqual([23, 17]);
});

test('I11: HTML-like reference filenames never become panel markup', async ({ page }) => {
  await openEditor(page); await openPanel(page);
  const name = '<img src=x onerror=window.filenameInjected=true>.png';
  await loadReference(page, solidImage(40, 30, [80, 150, 200]), name);
  await expect(page.locator('#stats-debug img, #stats-debug script, #stats-debug [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.filenameInjected)).toBeUndefined();
  expect(await page.locator('#stats-debug').textContent()).not.toContain(name);
});

// J: the exact M2 static set plus the two statistics modules; never widen it.
const STATIC_PATHS = new Set(['/', '/css/styles.css', '/js/editor.js', '/js/renderer.js',
  '/js/photo-file.js', '/shared/look-schema.js', '/favicon.ico', '/js/stats.js', '/js/stats-debug.js']);
test('J1/J2: sampling and editing send no photos, filenames or measurements over the network', async ({ page, context, baseURL }) => {
  const requests = [], sockets = [], origin = new URL(baseURL).origin;
  context.on('request', (request) => requests.push({ request, headers: request.allHeaders() }));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await openEditor(page);
  const sourceBytes = await uploadImage(page, solidImage(97, 61, [193, 77, 83]), 'private-source-marker.png');
  await openPanel(page);
  const referenceName = 'private-reference-marker.png';
  const reference = await referenceFile(page, solidImage(73, 47, [63, 131, 197]), referenceName);
  await page.locator('#reference-file').setInputFiles(reference);
  await expect(readout(page, 'reference', 'Sample')).toHaveText('73 x 47');
  await expect(slot(page, 'reference').locator('.stats-msg')).toHaveText('');
  const schema = await getSchema(page), exposure = findByEffect(schema, 'lightStops');
  await setSlider(page, schema, exposure, snap(exposure, exposure.default + exposure.step));
  const shown = await page.locator('#stats-debug dd, #stats-debug td').allTextContents();
  // Bare 0 and 1 also occur in HTTP versions/headers; match informative values
  // and complete multi-value readouts, with token boundaries for numbers.
  const measurements = [...new Set(shown.flatMap((text) => [text, ...(text.match(/-?\d+\.\d+|\d{2,}/g) ?? [])]))]
    .filter((text) => !['0', '1', 'no samples'].includes(text));
  await page.waitForLoadState('networkidle');
  expect(requests.length).toBeGreaterThan(0);
  for (const { request, headers } of requests) {
    const url = new URL(request.url());
    expect(request.method(), request.url()).toBe('GET');
    expect(request.postDataBuffer(), request.url()).toBeNull();
    expect(url.search).toBe(''); expect(url.hash).toBe('');
    if (url.protocol === 'blob:') expect(request.url()).toMatch(new RegExp(`^blob:${origin}/`));
    else { expect(url.origin).toBe(origin); expect(STATIC_PATHS.has(url.pathname), url.pathname).toBe(true); }
    const text = [decodeURIComponent(request.url()), JSON.stringify(await headers), request.postData() ?? ''].join('\n');
    expect(text).not.toMatch(/iVBORw0KGgo|\/9j\/|data:image/i);
    expect(text).not.toContain(referenceName);
    expect(text).not.toContain('private-source-marker.png');
    for (const bytes of [sourceBytes, reference.buffer]) expect(text).not.toContain(bytes.toString('base64').slice(0, 256));
    for (const measurement of measurements) {
      const escaped = measurement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(text, `leaked statistic ${measurement}`).not.toMatch(new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`));
    }
  }
  expect(sockets).toEqual([]);
  const paths = requests.map(({ request }) => new URL(request.url()).pathname);
  for (const required of ['/', '/js/editor.js', '/js/stats.js', '/js/stats-debug.js']) expect(paths).toContain(required);
});
// I12 is covered by the unchanged M2 upload/rendering specs in the same run.
