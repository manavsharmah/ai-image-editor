// Deterministic keyword fallback, used when the AI is unavailable or its
// answer is unusable. Sliders are found by their schema `effect`, never by
// name, and amounts are fractions of each slider's default-to-bound distance.
import { SLIDERS, DEFAULTS, clampLook } from '../../web/shared/look-schema.js';

// keyword -> { effect: fraction }. +1 would push a slider fully to its max,
// -1 fully to its min. Kept small so the result stays a gentle starting point.
const KEYWORDS = {
  warm: { warmth: 0.25 },
  cool: { warmth: -0.25 },
  bright: { lightStops: 0.1, lowerTones: 0.15 },
  dark: { lightStops: -0.1, upperTones: -0.15 },
  moody: { lightStops: -0.06, toneSpread: 0.15, lowerTones: -0.15, mutedColor: -0.15 },
  muted: { allColor: -0.25 },
  vibrant: { mutedColor: 0.25, allColor: 0.1 },
};

// Returns a complete, clamped look. No recognized keyword -> defaults.
export function keywordLook(prompt) {
  const words = new Set(String(prompt).toLowerCase().match(/[a-z]+/g) ?? []);
  const totals = {}; // effect -> summed fraction
  for (const [word, effects] of Object.entries(KEYWORDS)) {
    if (!words.has(word)) continue;
    for (const [effect, fraction] of Object.entries(effects)) {
      totals[effect] = (totals[effect] ?? 0) + fraction;
    }
  }

  const look = { ...DEFAULTS };
  for (const slider of SLIDERS) {
    const fraction = totals[slider.effect];
    if (!fraction) continue;
    const room = fraction > 0 ? slider.max - slider.default : slider.default - slider.min;
    look[slider.name] = slider.default + fraction * room;
  }
  return clampLook(look);
}
