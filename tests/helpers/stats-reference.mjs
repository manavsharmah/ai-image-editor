// Independent test oracle: standard sRGB / D65 formulas, never stats.js exports.
import assert from 'node:assert/strict';
import { BANDS } from '../../apps/web/shared/look-schema.js';

export function near(actual, expected, tolerance = 1e-6, label = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

export function finite(value, path = 'result') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is finite`);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`);
  }
}

export function pixels(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const color = typeof colorAt === 'function' ? colorAt(i) : colorAt;
    data.set([color[0], color[1], color[2], color[3] ?? 255], i * 4);
  }
  return { width, height, data };
}

export function referenceColor([r, g, b, alpha = 255]) {
  const encoded = [r, g, b].map((v) => (v * alpha / 255 + 255 - alpha) / 255);
  const linear = encoded.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const xyz = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
  ].map((row) => row.reduce((sum, v, i) => sum + v * linear[i], 0));
  const f = xyz.map((v, i) => {
    const t = v / [0.95047, 1, 1.08883][i];
    return t > (6 / 29) ** 3 ? t ** (1 / 3) : t / (3 * (6 / 29) ** 2) + 4 / 29;
  });
  const max = Math.max(...encoded), min = Math.min(...encoded), delta = max - min;
  let hue = null;
  if (delta > 0) {
    const index = encoded.indexOf(max);
    hue = (60 * ((encoded[(index + 1) % 3] - encoded[(index + 2) % 3]) / delta + 2 * index) + 360) % 360;
  }
  return {
    lab: { L: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) },
    Y: xyz[1], saturation: delta === 0 ? 0 : delta / (1 - Math.abs(max + min - 1)), hue,
  };
}

// Find the brightest byte-representable saturated color at this exact hue.
export function hueRgb(hue) {
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs(h % 2 - 1);
  const rgb = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h)];
  for (let peak = 255; peak > 0; peak--) {
    const values = rgb.map((v) => v * peak);
    if (values.every((v) => Math.abs(v - Math.round(v)) < 1e-9)) {
      const bytes = values.map(Math.round);
      near(referenceColor(bytes).hue, hue % 360, 1e-9, 'fixture hue');
      return bytes;
    }
  }
  throw new Error(`Cannot represent hue ${hue} exactly`);
}

// Locate the enclosing circular interval, then interpolate only its endpoints.
export function expectedWeights(hue) {
  const weights = BANDS.map(() => 0);
  if (hue === null) return weights;
  const h = (hue - BANDS[0].hue + 360) % 360 + BANDS[0].hue;
  for (let i = 0; i < BANDS.length; i++) {
    const right = i + 1 < BANDS.length ? BANDS[i + 1].hue : BANDS[0].hue + 360;
    if (h >= BANDS[i].hue && h < right) {
      const t = (h - BANDS[i].hue) / (right - BANDS[i].hue);
      weights[i] = 1 - t;
      weights[(i + 1) % BANDS.length] = t;
      break;
    }
  }
  return weights;
}

export function expectedSize(width, height) {
  const scale = Math.min(1, 256 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function checkBands(result, colors) {
  const expected = BANDS.map(() => ({ weight: 0, saturation: 0, luminance: 0 }));
  for (const color of colors) {
    const ref = referenceColor(color);
    expectedWeights(ref.hue).forEach((w, i) => {
      expected[i].weight += w;
      expected[i].saturation += w * ref.saturation;
      expected[i].luminance += w * ref.Y;
    });
  }
  BANDS.forEach((band, i) => {
    const actual = result.bands[band.name], ref = expected[i];
    near(actual.weight, ref.weight, 1e-9, `${band.label} weight`);
    for (const key of ['saturation', 'luminance']) {
      near(actual[key], ref.weight ? ref[key] / ref.weight : 0, 1e-6, `${band.label} ${key}`);
      if (!ref.weight) assert.equal(actual[key], 0);
    }
    if (!ref.weight) assert.equal(actual.weight, 0);
  });
}
