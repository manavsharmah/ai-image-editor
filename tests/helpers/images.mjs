// Synthetic test images and pixel measurements.
//
// Source pixels are computed here in Node, so they are independent expected
// data: they never come from the renderer under test. The browser is only
// used to encode them to PNG and to decode downloaded PNGs back to pixels.
// No external photos, fonts or network fixtures.

// Builds { width, height, pixels } from colorAt(x, y) -> [r, g, b]. Opaque.
function build(width, height, colorAt) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels.set([...colorAt(x, y), 255], i);
    }
  }
  return { width, height, pixels };
}

// Asymmetric: warm top band, varied middle, dark cool bottom, a white block
// top-left and a black block bottom-right. Any flip or shift changes pixels.
export function asymmetricImage() {
  return build(64, 48, (x, y) => {
    if (x < 8 && y < 8) return [250, 250, 250];
    if (x >= 56 && y >= 40) return [5, 5, 5];
    if (y < 16) return [220, 60 + x * 2, 40];
    if (y < 32) return [x * 4, y * 4, 255 - x * 3];
    return [20, 40 + x, 90 + (y - 32) * 5];
  });
}

// Neutral midtone gray ramp (100..131). Gray has no hue, so only light
// sliders affect it.
export function midtoneImage() {
  return build(32, 32, (x) => [100 + x, 100 + x, 100 + x]);
}

// Left half moderately saturated red, right half moderately saturated blue.
export const PATCH_SIZE = 32;
export const PATCH_RED = [200, 80, 80];
export const PATCH_BLUE = [80, 80, 200];
export function patchesImage() {
  return build(PATCH_SIZE * 2, PATCH_SIZE, (x) => (x < PATCH_SIZE ? PATCH_RED : PATCH_BLUE));
}

// Patch interiors, 4 px in from every edge, so filtering at the boundary
// between patches cannot affect the measurement.
const INSET = 4;
export const RED_RECT = { x: INSET, y: INSET, w: PATCH_SIZE - 2 * INSET, h: PATCH_SIZE - 2 * INSET };
export const BLUE_RECT = { ...RED_RECT, x: PATCH_SIZE + INSET };

// Encodes an image to PNG bytes in the browser with a 2D canvas.
// Opaque pixels make putImageData lossless (no premultiplied-alpha rounding).
export async function encodePng(page, image) {
  const base64 = await page.evaluate(async ({ width, height, data }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { width: image.width, height: image.height, data: Array.from(image.pixels) });
  return Buffer.from(base64, 'base64');
}

// Decodes PNG bytes back to RGBA pixels in the browser, with no color
// conversion or alpha premultiplication.
export async function decodePng(page, buffer) {
  const result = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data: Array.from(data) };
  }, buffer.toString('base64'));
  return { width: result.width, height: result.height, pixels: Uint8Array.from(result.data) };
}

// --- Measurements -----------------------------------------------------------

const fullRect = (image) => ({ x: 0, y: 0, w: image.width, h: image.height });

function* indices(image, rect = fullRect(image)) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) yield (y * image.width + x) * 4;
  }
}

// Mean of r, g and b over a region, in 0..255 levels.
export function meanBrightness(image, rect) {
  let sum = 0;
  let count = 0;
  for (const i of indices(image, rect)) {
    sum += image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2];
    count += 3;
  }
  return sum / count;
}

// Mean absolute per-channel RGB difference between two same-size images.
export function meanAbsRgbChange(a, b, rect) {
  let sum = 0;
  let count = 0;
  for (const i of indices(a, rect)) {
    for (let c = 0; c < 3; c++) sum += Math.abs(a.pixels[i + c] - b.pixels[i + c]);
    count += 3;
  }
  return sum / count;
}

// Mean channel spread measures distance from neutral gray, regardless of hue.
export function meanChannelSpread(image, rect) {
  let sum = 0;
  let count = 0;
  for (const i of indices(image, rect)) {
    const rgb = image.pixels.subarray(i, i + 3);
    sum += Math.max(...rgb) - Math.min(...rgb);
    count++;
  }
  return sum / count;
}

// Largest RGB channel difference, its pixel position, and the smallest alpha
// in `b`.
export function compareRgb(a, b) {
  let maxDiff = 0;
  let worst = null;
  let minAlpha = 255;
  for (const i of indices(a)) {
    for (let c = 0; c < 3; c++) {
      const diff = Math.abs(a.pixels[i + c] - b.pixels[i + c]);
      if (diff > maxDiff) {
        maxDiff = diff;
        const p = i / 4;
        worst = { x: p % a.width, y: Math.floor(p / a.width), channel: 'rgb'[c],
          expected: a.pixels[i + c], actual: b.pixels[i + c] };
      }
    }
    minAlpha = Math.min(minAlpha, b.pixels[i + 3]);
  }
  return { maxDiff, worst, minAlpha };
}
