// Image statistics for reference matching. Runs only in this browser.
//
// computeStats() is pure (no DOM), so node:test can exercise it directly.
// sampleImage() is the browser wrapper: it draws an image into a small 2D
// canvas and measures that canvas's pixels.
//
// Result contract (all numbers are full precision; format only for display):
// {
//   width, height,   // sample size in pixels
//   count,           // width * height
//   lab: {
//     mean: { L, a, b },  // CIELAB (D65). L is 0..100, a/b roughly -128..128
//     std:  { L, a, b },  // population standard deviation, same units
//   },
//   luminance: { p5, p50, p95 }, // relative luminance Y (linear light), 0..1
//   saturation,                  // mean HSL saturation of sRGB, 0..1
//   bands: {                     // one entry per BANDS item, in BANDS order
//     [band.name]: {
//       label,       // band.label, for display
//       saturation,  // weighted mean HSL saturation, 0..1 (0 if weight is 0)
//       luminance,   // weighted mean relative luminance Y, 0..1 (0 if weight is 0)
//       weight,      // effective number of samples in this band (sum of weights)
//     },
//   },
// }
//
// Note: HSL lightness ((max + min) / 2 of gamma-encoded sRGB) is NOT the same as
// relative luminance Y. Every "luminance" here is Y.
// These are measurements, not slider values: never pass them to clampLook().
import { BANDS } from '../shared/look-schema.js';

export const MAX_SAMPLE_SIDE = 256;

// D65 reference white for XYZ -> Lab.
const WHITE = { X: 0.95047, Y: 1, Z: 1.08883 };
// Below this chroma (in 0..1 sRGB) a pixel is gray and has no hue.
const ACHROMATIC = 1e-9;

// Distance in degrees from each band center to the next (wraps through red),
// matching the renderer's band blending.
const BAND_GAPS = BANDS.map((b, i) =>
  (BANDS[(i + 1) % BANDS.length].hue - b.hue + 360) % 360);

// Lookup table: 8-bit sRGB value -> linear light 0..1.
const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = toLinear(i / 255);

function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Standard piecewise CIELAB function.
function labF(t) {
  const d = 6 / 29;
  return t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

// Weight of a hue (degrees) in each band: 1 at a band center, falling linearly
// to 0 at the neighboring centers, so the weights of a hue add up to 1.
export function bandWeights(hue) {
  return BANDS.map((band, i) => {
    const d = ((hue - band.hue + 540) % 360) - 180; // signed, -180..180
    const gap = d >= 0 ? BAND_GAPS[i] : BAND_GAPS[(i + BANDS.length - 1) % BANDS.length];
    return Math.max(0, 1 - Math.abs(d) / gap);
  });
}

// Percentile from sorted values with linear interpolation at (n - 1) * p.
function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function checkInput(pixels) {
  if (pixels === null || typeof pixels !== 'object') {
    throw new TypeError('computeStats needs { width, height, data }');
  }
  const { width, height, data } = pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('width and height must be positive integers');
  }
  if (!(data instanceof Uint8ClampedArray || data instanceof Uint8Array)) {
    throw new TypeError('data must be a Uint8ClampedArray or Uint8Array of RGBA bytes');
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`data must have width * height * 4 = ${width * height * 4} bytes, got ${data.length}`);
  }
}

// Measures sRGB RGBA bytes. Transparent pixels are first composited onto
// opaque white, the same as the browser sampling path.
export function computeStats(pixels) {
  checkInput(pixels);
  const { width, height, data } = pixels;
  const count = width * height;
  const lums = new Float64Array(count);
  // Welford running mean and sum of squared differences, per Lab channel.
  const mean = [0, 0, 0];
  const m2 = [0, 0, 0];
  let satSum = 0;
  const bandSat = new Float64Array(BANDS.length);
  const bandLum = new Float64Array(BANDS.length);
  const bandWeight = new Float64Array(BANDS.length);

  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const alpha = data[i + 3];
    let r; let g; let b; // gamma-encoded sRGB, 0..1
    let lr; let lg; let lb; // linear light, 0..1
    if (alpha === 255) {
      r = data[i] / 255; g = data[i + 1] / 255; b = data[i + 2] / 255;
      lr = LINEAR[data[i]]; lg = LINEAR[data[i + 1]]; lb = LINEAR[data[i + 2]];
    } else {
      // Composite onto white in encoded sRGB, like a 2D canvas does.
      const a = alpha / 255;
      r = (data[i] / 255) * a + (1 - a);
      g = (data[i + 1] / 255) * a + (1 - a);
      b = (data[i + 2] / 255) * a + (1 - a);
      lr = toLinear(r); lg = toLinear(g); lb = toLinear(b);
    }

    // Linear sRGB -> XYZ (D65). Y is relative luminance.
    const X = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
    const Y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
    const Z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
    const fx = labF(X / WHITE.X);
    const fy = labF(Y / WHITE.Y);
    const fz = labF(Z / WHITE.Z);
    const lab = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    for (let c = 0; c < 3; c++) {
      const delta = lab[c] - mean[c];
      mean[c] += delta / (p + 1);
      m2[c] += delta * (lab[c] - mean[c]);
    }
    lums[p] = Y;

    // HSL saturation and hue of encoded sRGB.
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (chroma <= ACHROMATIC) continue; // gray, black or white: S = 0, no hue band
    const light = (max + min) / 2;
    const sat = Math.min(1, chroma / (1 - Math.abs(2 * light - 1)));
    satSum += sat;
    let hue;
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
    const weights = bandWeights(hue);
    for (let k = 0; k < BANDS.length; k++) {
      const w = weights[k];
      if (w === 0) continue;
      bandWeight[k] += w;
      bandSat[k] += w * sat;
      bandLum[k] += w * Y;
    }
  }

  lums.sort();
  // Rounding can make the variance a tiny negative number; clamp before sqrt.
  const std = m2.map((v) => Math.sqrt(Math.max(0, v / count)));
  const bands = {};
  BANDS.forEach((band, k) => {
    const weight = bandWeight[k];
    bands[band.name] = {
      label: band.label,
      saturation: weight > 0 ? bandSat[k] / weight : 0,
      luminance: weight > 0 ? bandLum[k] / weight : 0,
      weight,
    };
  });

  return {
    width,
    height,
    count,
    lab: {
      mean: { L: mean[0], a: mean[1], b: mean[2] },
      std: { L: std[0], a: std[1], b: std[2] },
    },
    luminance: {
      p5: percentile(lums, 0.05),
      p50: percentile(lums, 0.5),
      p95: percentile(lums, 0.95),
    },
    saturation: satSum / count,
    bands,
  };
}

// Sample size that fits the longest side to MAX_SAMPLE_SIDE, never enlarging.
export function sampleSize(width, height) {
  const scale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Browser only. Draws `image` (ImageBitmap, image or canvas) onto white in a
// small sRGB canvas and measures it. Returns { canvas, stats }; the canvas is
// the exact composite that was measured, so it can be shown as a thumbnail.
// Reads `image` synchronously and does not keep or close it.
export function sampleImage(image) {
  const { width, height } = sampleSize(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
  return { canvas, stats: computeStats({ width, height, data }) };
}
