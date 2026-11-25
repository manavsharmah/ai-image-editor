// Single source of truth for every slider. Used by the browser and the Worker.
// Pure JS: no imports, no secrets.
//
// A "look" is a flat object of slider name -> number,
// e.g. { exposure: 0.5, contrast: 10, blueSaturation: -20 }.

// Most sliders go from -100 to 100 and do nothing at 0.
const RANGE = { min: -100, max: 100, default: 0, step: 1 };

const GLOBAL_SLIDERS = [
  // unit "stops": the value has a physical meaning (+1 doubles the light).
  { name: 'exposure', label: 'Exposure', min: -5, max: 5, default: 0, step: 0.05, unit: 'stops' },
  { name: 'contrast', label: 'Contrast', ...RANGE },
  { name: 'highlights', label: 'Highlights', ...RANGE },
  { name: 'shadows', label: 'Shadows', ...RANGE },
  { name: 'whites', label: 'Whites', ...RANGE },
  { name: 'blacks', label: 'Blacks', ...RANGE },
  { name: 'temperature', label: 'Temperature', ...RANGE }, // + is warmer
  { name: 'tint', label: 'Tint', ...RANGE }, // + is magenta, - is green
  { name: 'vibrance', label: 'Vibrance', ...RANGE },
  { name: 'saturation', label: 'Saturation', ...RANGE },
];

// Color bands in hue order. `hue` is the band center in degrees.
export const BANDS = Object.freeze([
  { name: 'red', label: 'Red', hue: 0 },
  { name: 'orange', label: 'Orange', hue: 30 },
  { name: 'yellow', label: 'Yellow', hue: 60 },
  { name: 'green', label: 'Green', hue: 120 },
  { name: 'aqua', label: 'Aqua', hue: 180 },
  { name: 'blue', label: 'Blue', hue: 240 },
  { name: 'purple', label: 'Purple', hue: 270 },
  { name: 'magenta', label: 'Magenta', hue: 300 },
].map(Object.freeze));

// The three adjustments every band has.
export const CHANNELS = Object.freeze(['Hue', 'Saturation', 'Luminance']);

// Band sliders are named band + channel: redHue, redSaturation, ...
const BAND_SLIDERS = BANDS.flatMap((band) =>
  CHANNELS.map((channel) => ({
    name: band.name + channel,
    label: channel,
    band: band.name,
    channel,
    ...RANGE,
  })));

export const SLIDERS = Object.freeze(
  [...GLOBAL_SLIDERS, ...BAND_SLIDERS].map((slider) => Object.freeze(slider)));

// The neutral look. Copy it before changing it: { ...DEFAULTS }.
export const DEFAULTS = Object.freeze(
  Object.fromEntries(SLIDERS.map((s) => [s.name, s.default])));

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Always returns a complete, in-range look. Missing or non-numeric values
// become the default, unknown keys are dropped.
export function clampLook(look) {
  const input = isObject(look) ? look : {};
  const result = {};
  for (const s of SLIDERS) {
    const value = Object.hasOwn(input, s.name) ? input[s.name] : s.default;
    result[s.name] = Number.isFinite(value)
      ? Math.min(s.max, Math.max(s.min, value))
      : s.default;
  }
  return result;
}

// Strict check of a look. Sliders may be missing (they mean "default"), but
// there must be at least one, and all must be known, numeric and in range.
// Returns { valid, errors }.
export function validateLook(look) {
  if (!isObject(look)) return { valid: false, errors: ['look must be an object'] };
  const names = Object.keys(look);
  const errors = names.length ? [] : ['look has no sliders'];
  for (const name of names) {
    const slider = SLIDERS.find((s) => s.name === name);
    const value = look[name];
    if (!slider) errors.push(`unknown slider: ${name}`);
    else if (!Number.isFinite(value)) errors.push(`${name} must be a finite number`);
    else if (value < slider.min || value > slider.max) {
      errors.push(`${name} must be between ${slider.min} and ${slider.max}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
