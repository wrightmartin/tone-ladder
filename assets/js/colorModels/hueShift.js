/**
 * Core hue-shift algorithm for Tone Ladder
 * Generates perceptually uniform tonal ramps with artist-style hue shifts
 */

import {
  hexToOklch,
  oklchToHex,
  clampToSrgbGamut,
  normalizeHue,
  hueDifference
} from './convert.js';

// Mode configurations
const MODE_CONFIG = {
  conservative: {
    maxHueShift: 8   // degrees (subtle shifts)
  },
  painterly: {
    maxHueShift: 22  // degrees (pronounced artistic shifts)
  }
};

// Lightness bounds (prevents pure white/black)
const L_MIN = 0.08;
const L_MAX = 0.98;

/**
 * Generates a tonal ramp with hue shifts based on light temperature
 *
 * @param {Object} baseOklch - Base color in OKLCH { L, C, H }
 * @param {number} temperature - Light temperature -1 (cool) to +1 (warm)
 * @param {number} steps - Number of steps (9 or 11)
 * @param {string} mode - 'conservative' or 'painterly'
 * @returns {Object[]} Array of OKLCH colors ordered darkest to lightest
 */
export function generateOklchRamp(baseOklch, temperature, steps, mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.painterly;
  const maxShift = config.maxHueShift;

  // Find the midpoint index (where base color will be placed)
  const midIndex = Math.floor(steps / 2);

  // Generate lightness values from dark to light
  const lightnessValues = [];
  for (let i = 0; i < steps; i++) {
    // Map step index to lightness range [L_MIN, L_MAX]
    const t = i / (steps - 1);
    lightnessValues.push(L_MIN + t * (L_MAX - L_MIN));
  }

  // Adjust lightness values so midpoint matches base color's lightness
  // while keeping the range within bounds
  const baseLightness = Math.max(L_MIN, Math.min(L_MAX, baseOklch.L));
  const midLightness = lightnessValues[midIndex];
  const lightnessOffset = baseLightness - midLightness;

  // Apply offset with compression at extremes
  for (let i = 0; i < steps; i++) {
    let adjusted = lightnessValues[i] + lightnessOffset;

    // Compress toward bounds if exceeding
    if (adjusted < L_MIN) {
      const distFromMid = midIndex - i;
      const maxDist = midIndex;
      const compressionFactor = distFromMid / maxDist;
      adjusted = L_MIN + (baseLightness - L_MIN) * (1 - compressionFactor);
    } else if (adjusted > L_MAX) {
      const distFromMid = i - midIndex;
      const maxDist = steps - 1 - midIndex;
      const compressionFactor = distFromMid / maxDist;
      adjusted = L_MAX - (L_MAX - baseLightness) * (1 - compressionFactor);
    }

    lightnessValues[i] = Math.max(L_MIN, Math.min(L_MAX, adjusted));
  }

  // Generate the ramp
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const L = lightnessValues[i];

    // Calculate position relative to midpoint (-1 to +1)
    // Negative = darker than base, Positive = lighter than base
    const relativePosition = (i - midIndex) / midIndex;

    // Calculate hue shift
    // For warm light (+temperature):
    //   - Highlights (positive position) shift toward warm (yellow ~80deg)
    //   - Shadows (negative position) shift toward cool (blue/purple ~270deg)
    // For cool light (-temperature): opposite
    const hueShift = calculateHueShift(
      baseOklch.H,
      relativePosition,
      temperature,
      maxShift
    );

    const H = normalizeHue(baseOklch.H + hueShift);

    // Calculate chroma with saturation curve (peaks at midtones)
    const C = calculateChroma(baseOklch.C, relativePosition);

    // Clamp to sRGB gamut
    const clamped = clampToSrgbGamut({ L, C, H });
    ramp.push(clamped);
  }

  return ramp;
}

/**
 * Calculate hue shift for a given position in the ramp
 *
 * Warm light creates the classic "warm highlights, cool shadows" look:
 * - Yellow-orange highlights (shift toward ~60-80deg on color wheel)
 * - Blue-purple shadows (shift toward ~240-280deg)
 *
 * The shift is applied as a delta from the base hue, not an absolute target.
 */
function calculateHueShift(baseHue, relativePosition, temperature, maxShift) {
  if (temperature === 0) return 0;

  // Magnitude increases toward extremes (slight ease-in)
  const magnitude = Math.pow(Math.abs(relativePosition), 1.1);

  // Temperature influence uses sqrt curve for more pronounced effect
  // at moderate temperature values while preserving direction control
  const tempSign = Math.sign(temperature);
  const tempStrength = Math.sqrt(Math.abs(temperature));

  // Direction: positive = shift hue up, negative = shift hue down
  // Warm light (+temp): highlights shift +, shadows shift -
  // Cool light (-temp): highlights shift -, shadows shift +
  const direction = tempSign * relativePosition;

  const shiftAmount = direction * magnitude * tempStrength * maxShift;

  return shiftAmount;
}

/**
 * Calculate chroma for a given position in the ramp
 * Saturation peaks near midtones and decreases toward extremes
 */
function calculateChroma(baseChroma, relativePosition) {
  // Saturation curve: peaks at midpoint, decreases toward extremes
  // Using a cosine curve for smooth falloff
  const saturationMultiplier = 0.5 + 0.5 * Math.cos(relativePosition * Math.PI);

  // Apply a minimum retention so colors don't become completely desaturated
  const minRetention = 0.4;
  const effectiveMultiplier = minRetention + (1 - minRetention) * saturationMultiplier;

  return baseChroma * effectiveMultiplier;
}

/**
 * Validation helper - logs hue deltas per step to console
 * Use this to verify the algorithm meets the >=8 degree rule at extremes
 *
 * @param {string} baseHex - Base color as hex
 * @param {number} temperature - Light temperature
 * @param {number} steps - Number of steps
 * @param {string} mode - 'conservative' or 'painterly'
 */
export function validateHueDeltas(baseHex, temperature, steps, mode) {
  const baseOklch = hexToOklch(baseHex);
  const ramp = generateOklchRamp(baseOklch, temperature, steps, mode);

  const midIndex = Math.floor(steps / 2);
  const baseHue = baseOklch.H;

  console.group(`Hue Shift Validation - ${mode} mode`);
  console.log(`Base: ${baseHex} (H: ${baseHue.toFixed(1)})`);
  console.log(`Temperature: ${temperature}`);
  console.log(`Steps: ${steps}`);
  console.log('---');

  const deltas = [];
  ramp.forEach((color, i) => {
    const delta = hueDifference(baseHue, color.H);
    deltas.push(delta);
    const label = i === midIndex ? '(BASE)' : i < midIndex ? '(shadow)' : '(highlight)';
    console.log(
      `Step ${i}: L=${color.L.toFixed(3)}, C=${color.C.toFixed(3)}, ` +
      `H=${color.H.toFixed(1)} | delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ${label}`
    );
  });

  const darkestDelta = Math.abs(deltas[0]);
  const lightestDelta = Math.abs(deltas[steps - 1]);

  console.log('---');
  console.log(`Darkest step hue delta: ${darkestDelta.toFixed(1)}`);
  console.log(`Lightest step hue delta: ${lightestDelta.toFixed(1)}`);

  if (mode === 'painterly') {
    const passes = darkestDelta >= 8 && lightestDelta >= 8;
    console.log(`Painterly 8 rule: ${passes ? 'PASS' : 'FAIL'}`);
  }

  console.groupEnd();

  return {
    deltas,
    darkestDelta,
    lightestDelta,
    ramp
  };
}

/**
 * Convert OKLCH ramp to hex strings
 * @param {Object[]} oklchRamp - Array of OKLCH colors
 * @returns {string[]} Array of hex strings
 */
export function rampToHex(oklchRamp) {
  return oklchRamp.map(oklchToHex);
}
