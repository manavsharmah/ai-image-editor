import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS } from '../apps/web/shared/look-schema.js';
import { near, finite, pixels, referenceColor, hueRgb, expectedWeights, expectedSize, checkBands } from './helpers/stats-reference.mjs';
for (const key of ['document', 'window', 'HTMLCanvasElement']) {
  assert.equal(typeof globalThis[key], 'undefined');
}
const stats = await import('../apps/web/js/stats.js');
const { computeStats, sampleSize, bandWeights } = stats;
const channels = ['L', 'a', 'b'];
const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort());

// Import above happens before any test with no DOM globals present.
test('A1: module imports without DOM globals and exposes the public API', () => {
  for (const key of ['computeStats', 'sampleImage', 'sampleSize', 'bandWeights']) assert.equal(typeof stats[key], 'function');
  assert.equal(stats.MAX_SAMPLE_SIDE, 256);
});

test('A2–A5: exact contract, schema order, ranges, chromatic counts and immutable input', () => {
  let seed = 123456;
  const byte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
  const input = pixels(16, 16, (i) => i % 7 === 0 ? [128, 128, 128] : [byte(), byte(), byte()]);
  const copy = input.data.slice();
  const result = computeStats(input);
  assert.deepEqual(input.data, copy);
  keys(result, ['width', 'height', 'count', 'lab', 'luminance', 'saturation', 'bands']);
  assert.deepEqual([result.width, result.height, result.count], [16, 16, 256]);
  keys(result.lab, ['mean', 'std']);
  keys(result.lab.mean, channels); keys(result.lab.std, channels);
  keys(result.luminance, ['p5', 'p50', 'p95']);
  assert.deepEqual(Object.keys(result.bands), BANDS.map((b) => b.name));
  finite(result);
  assert.ok(result.lab.mean.L >= 0 && result.lab.mean.L <= 100);
  for (const value of Object.values(result.lab.std)) assert.ok(value >= 0);
  const { p5, p50, p95 } = result.luminance;
  assert.ok(0 <= p5 && p5 <= p50 && p50 <= p95 && p95 <= 1);
  assert.ok(result.saturation >= 0 && result.saturation <= 1);
  let totalWeight = 0, chromatic = 0;
  for (let i = 0; i < input.data.length; i += 4) {
    const [r, g, b] = input.data.subarray(i, i + 3);
    if (r !== g || g !== b) chromatic++;
  }
  for (const band of BANDS) {
    const value = result.bands[band.name];
    keys(value, ['label', 'saturation', 'luminance', 'weight']);
    assert.equal(value.label, band.label);
    for (const key of ['saturation', 'luminance']) assert.ok(value[key] >= 0 && value[key] <= 1);
    assert.ok(value.weight >= 0); totalWeight += value.weight;
  }
  near(totalWeight, chromatic);
});

const solids = [
  { name: 'black', rgb: [0, 0, 0], lab: [0, 0, 0], saturation: 0 },
  { name: 'white', rgb: [255, 255, 255], lab: [100, 0, 0], saturation: 0 },
  { name: 'gray', rgb: [128, 128, 128], lab: [53.585, 0, 0], saturation: 0 },
  { name: 'primary R', rgb: [255, 0, 0], lab: [53.24, 80.09, 67.20], saturation: 1 },
  { name: 'primary G', rgb: [0, 255, 0], lab: [87.73, -86.18, 83.18], saturation: 1 },
  { name: 'primary B', rgb: [0, 0, 255], lab: [32.30, 79.19, -107.86], saturation: 1 },
  { name: 'non-primary centre', rgb: hueRgb(BANDS[1].hue), saturation: 1 },
];
for (const color of solids) for (const [width, height] of [[1, 1], [7, 5]]) {
  test(`B1–B8/E4: ${color.name}, ${width}x${height}`, () => {
    const result = computeStats(pixels(width, height, color.rgb)), ref = referenceColor(color.rgb);
    finite(result);
    assert.equal(result.count, width * height);
    channels.forEach((key, i) => {
      near(result.lab.mean[key], color.lab?.[i] ?? ref.lab[key], 0.05);
      near(result.lab.std[key], 0, 1e-9);
    });
    // Table Y values are rounded to five decimals; use the supplied formula
    // for the spec's tighter 1e-6 luminance tolerance.
    for (const y of Object.values(result.luminance)) near(y, ref.Y);
    near(result.luminance.p5, result.luminance.p50, 1e-12);
    near(result.luminance.p50, result.luminance.p95, 1e-12);
    near(result.saturation, color.saturation);
    checkBands(result, Array(width * height).fill(color.rgb));
  });
}

for (const [width, height] of [[2, 2], [10, 10], [1, 2]]) {
  test(`C1: equal black/white ${width}x${height}, population std and interpolation`, () => {
    const result = computeStats(pixels(width, height, (i) => i < width * height / 2 ? [0, 0, 0] : [255, 255, 255]));
    near(result.lab.mean.L, 50, 0.05); near(result.lab.std.L, 50, 0.05);
    for (const key of ['a', 'b']) { near(result.lab.mean[key], 0, 0.05); near(result.lab.std[key], 0, 0.05); }
    near(result.luminance.p5, width * height === 2 ? 0.05 : 0);
    near(result.luminance.p50, 0.5);
    near(result.luminance.p95, width * height === 2 ? 0.95 : 1);
    near(result.saturation, 0);
    for (const band of Object.values(result.bands)) assert.equal(band.weight, 0);
  });
}

test('C2: shuffled grayscale ramp uses sorted (n−1)p interpolation', () => {
  const levels = [128, 255, 8, 64, 200, 0, 32, 240, 96];
  const result = computeStats(pixels(1, levels.length, (i) => Array(3).fill(levels[i])));
  const ys = levels.map((v) => referenceColor([v, v, v]).Y).sort((a, b) => a - b);
  for (const [key, p] of [['p5', 0.05], ['p50', 0.5], ['p95', 0.95]]) {
    const pos = (ys.length - 1) * p, lo = Math.floor(pos), fraction = pos - lo;
    near(result.luminance[key], ys[lo] * (1 - fraction) + ys[Math.ceil(pos)] * fraction);
  }
});

test('C3: unequal two-colour mix uses population standard deviation', () => {
  const [a, b] = [solids[3], solids[5]];
  const result = computeStats(pixels(2, 2, (i) => i < 3 ? a.rgb : b.rgb));
  channels.forEach((key, i) => {
    const mean = (3 * a.lab[i] + b.lab[i]) / 4;
    const std = Math.sqrt((3 * (a.lab[i] - mean) ** 2 + (b.lab[i] - mean) ** 2) / 4);
    near(result.lab.mean[key], mean, 0.05); near(result.lab.std[key], std, 0.05);
  });
});

test('C4: achromatic pixels contribute zero to global saturation', () => {
  near(computeStats(pixels(2, 1, (i) => i ? [128, 128, 128] : hueRgb(BANDS[0].hue))).saturation, 0.5);
});

test('C5: large solid mid colour has finite, stable zero variance', () => {
  const result = computeStats(pixels(256, 256, [83, 127, 169]));
  finite(result);
  for (const value of Object.values(result.lab.std)) near(value, 0, 1e-6);
});

const hueCases = BANDS.map((band) => [band.label, band.hue]);
for (const index of [0, 2]) hueCases.push([`midpoint after ${BANDS[index].label}`, (BANDS[index].hue + BANDS[index + 1].hue) / 2]);
const wrapGap = BANDS[0].hue + 360 - BANDS.at(-1).hue;
for (const fraction of [0.5, 0.75]) hueCases.push([`wrap ${fraction}`, (BANDS.at(-1).hue + wrapGap * fraction) % 360]);
for (const [label, hue] of hueCases) {
  test(`D1–D3: schema-derived hue ${label}`, () => {
    const rgb = hueRgb(hue);
    near(referenceColor(rgb).hue, hue, 1e-9);
    const result = computeStats(pixels(3, 2, rgb));
    checkBands(result, Array(6).fill(rgb)); finite(result);
  });
}

test('D4/D5: same-hue means and fractional mixed membership are weighted', () => {
  const first = hueRgb(BANDS[0].hue);
  const dim = first.map((v) => Math.round(v * 128 / 255));
  near(referenceColor(dim).hue, BANDS[0].hue, 1e-9);
  for (const second of [dim, hueRgb((BANDS[0].hue + BANDS[1].hue) / 2)]) {
    const colors = [first, second];
    checkBands(computeStats(pixels(2, 1, (i) => colors[i])), colors);
  }
});

test('D6: gray/black/white change global statistics without fabricating hue', () => {
  const rgb = hueRgb(BANDS[0].hue), original = computeStats(pixels(1, 1, rgb));
  for (const count of [1, 3, 20]) {
    const result = computeStats(pixels(count + 1, 1, (i) => i === 0 ? rgb : Array(3).fill([0, 128, 255][i % 3])));
    assert.deepEqual(result.bands, original.bands);
    near(result.saturation, 1 / (count + 1));
    assert.notDeepEqual(result.lab, original.lab);
  }
});

test('D7: complete hue sweep has only adjacent weights and sums to one', () => {
  for (const hue of [...Array.from({ length: 360 }, (_, i) => i), 359.9]) {
    const actual = bandWeights(hue), expected = expectedWeights(hue);
    assert.equal(actual.length, BANDS.length);
    actual.forEach((w, i) => { assert.ok(w >= 0 && w <= 1); near(w, expected[i], 1e-9); });
    near(actual.reduce((a, b) => a + b, 0), 1, 1e-9);
    const nonzero = actual.flatMap((w, i) => w > 0 ? [i] : []);
    assert.ok(nonzero.length <= 2);
    if (nonzero.length === 2) assert.ok(nonzero[1] - nonzero[0] === 1 || nonzero[1] - nonzero[0] === BANDS.length - 1);
  }
});

test('E1/E2: transparent RGB is ignored and composites to white', () => {
  for (const rgb of [[0, 0, 0], hueRgb(BANDS[0].hue)]) {
    assert.deepEqual(computeStats(pixels(1, 1, [...rgb, 0])), computeStats(pixels(1, 1, [255, 255, 255])));
  }
  let seed = 4321;
  const byte = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; };
  const result = computeStats(pixels(11, 9, () => [byte(), byte(), byte(), 0]));
  assert.deepEqual(result, computeStats(pixels(11, 9, [255, 255, 255])));
  near(result.lab.mean.L, 100, 0.05); near(result.luminance.p50, 1);
  for (const band of Object.values(result.bands)) assert.equal(band.weight, 0);
});

test('E3: partial alpha composites in encoded sRGB before conversion', () => {
  const rgb = hueRgb(BANDS[0].hue), rgba = [...rgb, 128], ref = referenceColor(rgba);
  const result = computeStats(pixels(1, 1, rgba));
  for (const key of channels) near(result.lab.mean[key], ref.lab[key], 0.05);
  for (const y of Object.values(result.luminance)) near(y, ref.Y);
  near(result.saturation, ref.saturation); checkBands(result, [rgba]); finite(result);
  assert.ok(result.lab.mean.L > referenceColor(rgb).lab.L && result.lab.mean.L < 100);
});

const invalid = [undefined, null, 42, 'pixels', { width: 1, height: 1 },
  ...[[], new Float32Array(4), new ArrayBuffer(4)].map((data) => ({ width: 1, height: 1, data })),
  ...['width', 'height'].flatMap((key) => [0, -1, 1.5, NaN, Infinity, '1'].map((v) => ({ ...pixels(1, 1, [0, 0, 0]), [key]: v }))),
  ...[3, 5, 12].map((length) => ({ width: length === 12 ? 2 : 1, height: length === 12 ? 2 : 1, data: new Uint8ClampedArray(length) })),
  { width: 0, height: 0, data: new Uint8ClampedArray() },
];
invalid.forEach((input, i) => test(`F1–F5: malformed input ${i + 1} throws Error`, () => assert.throws(() => computeStats(input), Error)));
test('F: both byte array types are accepted identically', () => {
  const input = pixels(3, 2, (i) => [i * 40, 80, 130, i * 50]);
  assert.deepEqual(computeStats(input), computeStats({ ...input, data: new Uint8Array(input.data) }));
});

const sizes = [[4000, 3000], [3000, 4000], [1024, 1024], [256, 100], [100, 50], [1, 1], [10000, 10], [10, 10000], [257, 255], [600, 400]];
for (const [w, h] of sizes) test(`G1–G4: sample size ${w}x${h}`, () => {
  const result = sampleSize(w, h), scale = Math.min(1, 256 / Math.max(w, h));
  assert.deepEqual(result, expectedSize(w, h));
  assert.ok(Math.max(result.width, result.height) <= 256);
  assert.ok(result.width <= w && result.height <= h);
  // Only the minimum-one rule can exceed half a pixel of rounding error.
  for (const [actual, ideal] of [[result.width, w * scale], [result.height, h * scale]]) {
    assert.ok(Math.abs(actual - ideal) <= 0.5 || actual === 1 && ideal < 0.5);
  }
});
