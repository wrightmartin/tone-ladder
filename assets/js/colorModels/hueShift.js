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

// =============================================================================
// TUNABLE CONSTANTS - adjust these to calibrate mode behavior
// =============================================================================

// Mode configurations - tuned for visible separation between modes
const MODE_CONFIG = {
  conservative: {
    maxHueShift: 18,        // degrees - noticeable, tasteful shift
    chromaRetention: 0.40,  // minimum chroma at extremes
    chromaCurveExponent: 1.0, // standard cosine falloff
    convergenceStrength: 0.45 // highlight convergence toward light anchor
  },
  painterly: {
    maxHueShift: 38,        // degrees - bold, dramatic artistic shifts
    chromaRetention: 0.28,  // allow strong desaturation for drama
    chromaCurveExponent: 0.8, // slower falloff, keeps saturation longer
    convergenceStrength: 0.85 // stronger convergence for dramatic effect
  }
};

// Light color anchor hues (OKLCH hue angles)
// Highlights converge toward these based on temperature sign
const WARM_LIGHT_ANCHOR_H = 65;   // amber/golden
const COOL_LIGHT_ANCHOR_H = 205;  // cyan/sky

// Hue stability thresholds - prevents odd casts when chroma is very low
// Below CHROMA_FLOOR, hue shift is fully frozen (color is nearly neutral)
// Between FLOOR and REF, hue shift is progressively damped
const HUE_STABILITY_CHROMA_FLOOR = 0.012;
const HUE_STABILITY_CHROMA_REF = 0.045;

// Temperature response curve exponent
// > 1 compresses small values (gentle near neutral, strong at extremes)
// 1.0 = linear, 2.0 = quadratic
const TEMP_RESPONSE_EXPONENT = 1.6;

// Lightness bounds (prevents pure white/black)
const L_MIN = 0.08;
const L_MAX = 0.98;

/**
 * Hue stability damping factor
 * Returns 0-1 multiplier for hue shift based on target chroma
 * When chroma is very low (near neutral), hue becomes unstable and can
 * produce odd casts (pink/lavender near white). This dampens the shift.
 *
 * @param {number} chroma - Target chroma value
 * @returns {number} Damping factor 0-1 (0 = no shift, 1 = full shift)
 */
function getHueStabilityFactor(chroma) {
  if (chroma <= HUE_STABILITY_CHROMA_FLOOR) return 0;
  if (chroma >= HUE_STABILITY_CHROMA_REF) return 1;

  // Smooth ease-in curve for gradual transition
  const t = (chroma - HUE_STABILITY_CHROMA_FLOOR) /
            (HUE_STABILITY_CHROMA_REF - HUE_STABILITY_CHROMA_FLOOR);
  return t * t; // Quadratic ease-in
}

/**
 * Map temperature to perceptual response curve
 * Uses power function: sign(t) * |t|^γ
 *
 * With γ > 1:
 * - Small values are compressed (gentle near neutral)
 * - Large values approach 1 (strong at extremes)
 * - Continuous, monotonic, always passes through 0 and ±1
 * - Sign is preserved (+ = warm, - = cool)
 *
 * @param {number} t - Raw temperature (-1 to +1)
 * @returns {number} Mapped temperature (-1 to +1)
 */
function mapTemperature(t) {
  return Math.sign(t) * Math.pow(Math.abs(t), TEMP_RESPONSE_EXPONENT);
}

/**
 * Smoothstep interpolation
 * Returns 0 when x <= edge0, 1 when x >= edge1, smooth curve between
 *
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Input value
 * @returns {number} Smoothed value 0-1
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Blend between two hue angles using shortest arc
 * Handles wraparound at 0/360 correctly
 *
 * @param {number} h1 - Start hue (degrees)
 * @param {number} h2 - End hue (degrees)
 * @param {number} w - Blend weight 0-1 (0 = h1, 1 = h2)
 * @returns {number} Interpolated hue (degrees, normalized 0-360)
 */
function blendHueDegrees(h1, h2, w) {
  // Normalize both hues to 0-360
  h1 = ((h1 % 360) + 360) % 360;
  h2 = ((h2 % 360) + 360) % 360;

  // Find shortest arc direction
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  // Interpolate and normalize result
  const result = h1 + delta * w;
  return ((result % 360) + 360) % 360;
}

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

    // Calculate target chroma FIRST (needed for hue stability check)
    const targetChroma = calculateChroma(baseOklch.C, relativePosition, config);

    // Calculate raw hue shift
    // For warm light (+temperature):
    //   - Highlights (positive position) shift toward warm (yellow ~80deg)
    //   - Shadows (negative position) shift toward cool (blue/purple ~270deg)
    // For cool light (-temperature): opposite
    const rawHueShift = calculateHueShift(
      baseOklch.H,
      relativePosition,
      temperature,
      maxShift
    );

    // Apply hue stability damping when chroma is low
    // This prevents odd pink/lavender casts near white
    const stabilityFactor = getHueStabilityFactor(targetChroma);
    const hueShift = rawHueShift * stabilityFactor;

    let H = normalizeHue(baseOklch.H + hueShift);

    // Apply highlight convergence toward light anchor
    // Only for highlights (relativePosition > 0) and when temperature !== 0
    if (relativePosition > 0 && temperature !== 0) {
      // Position within highlight range: 0 at base, 1 at lightest
      const highlightPosition = relativePosition; // already 0-1 for highlights

      // Convergence weight: kicks in near the top third, scales with temperature
      const wPos = smoothstep(0.6, 1.0, highlightPosition);
      const wTemp = Math.pow(Math.abs(temperature), 0.7);
      const w = wPos * wTemp * config.convergenceStrength;

      // Choose anchor based on temperature sign
      const anchorHue = temperature > 0 ? WARM_LIGHT_ANCHOR_H : COOL_LIGHT_ANCHOR_H;

      // Blend toward anchor using shortest arc
      H = blendHueDegrees(H, anchorHue, w);
    }

    const C = targetChroma;

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

  // Apply perceptual temperature curve: gentle near neutral, strong at extremes
  const mappedTemp = mapTemperature(temperature);

  // Direction: negative = shift toward warm (lower hue), positive = shift toward cool (higher hue)
  // Warm light (+temp): highlights shift toward warm (-), shadows shift toward cool (+)
  // Cool light (-temp): highlights shift toward cool (+), shadows shift toward warm (-)
  const direction = -Math.sign(mappedTemp) * relativePosition;
  const tempStrength = Math.abs(mappedTemp);

  const shiftAmount = direction * magnitude * tempStrength * maxShift;

  return shiftAmount;
}

/**
 * Calculate chroma for a given position in the ramp
 * Saturation peaks near midtones and decreases toward extremes
 *
 * @param {number} baseChroma - Base color chroma
 * @param {number} relativePosition - Position in ramp (-1 to +1)
 * @param {Object} config - Mode configuration with chromaRetention and chromaCurveExponent
 */
function calculateChroma(baseChroma, relativePosition, config) {
  const minRetention = config.chromaRetention;
  const exponent = config.chromaCurveExponent;

  // Saturation curve: peaks at midpoint, decreases toward extremes
  // Using a cosine curve for smooth falloff, with exponent to control speed
  const rawMultiplier = 0.5 + 0.5 * Math.cos(relativePosition * Math.PI);

  // Apply exponent to control falloff speed
  // exponent < 1 = slower falloff (keeps saturation longer) - good for painterly
  // exponent > 1 = faster falloff (desaturates quicker)
  const saturationMultiplier = Math.pow(rawMultiplier, exponent);

  // Apply minimum retention so colors don't become completely desaturated
  const effectiveMultiplier = minRetention + (1 - minRetention) * saturationMultiplier;

  return baseChroma * effectiveMultiplier;
}

/**
 * Validation helper - logs hue deltas per step to console
 * Use this to verify the algorithm behavior
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

  console.group(`Hue Shift Validation - ${mode.toUpperCase()} mode`);
  console.log(`Base: ${baseHex} (H: ${baseHue.toFixed(1)}, C: ${baseOklch.C.toFixed(3)})`);
  console.log(`Temperature: ${temperature}`);
  console.log(`Steps: ${steps}`);
  console.log(`Max hue shift setting: ${MODE_CONFIG[mode].maxHueShift}°`);
  console.log('---');

  const deltas = [];
  ramp.forEach((color, i) => {
    const delta = hueDifference(baseHue, color.H);
    deltas.push(delta);
    const label = i === midIndex ? '(BASE)' : i < midIndex ? '(shadow)' : '(highlight)';
    console.log(
      `Step ${i}: L=${color.L.toFixed(3)}, C=${color.C.toFixed(3)}, ` +
      `H=${color.H.toFixed(1)} | Δhue: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}° ${label}`
    );
  });

  const darkestDelta = Math.abs(deltas[0]);
  const lightestDelta = Math.abs(deltas[steps - 1]);

  console.log('---');
  console.log(`Shadow (darkest) hue delta: ${darkestDelta.toFixed(1)}°`);
  console.log(`Highlight (lightest) hue delta: ${lightestDelta.toFixed(1)}°`);

  console.groupEnd();

  return {
    deltas,
    darkestDelta,
    lightestDelta,
    ramp
  };
}

/**
 * Compare Conservative vs Painterly hue shifts for a given color
 * Logs a side-by-side summary to console
 *
 * @param {string} baseHex - Base color as hex (default: saturated blue #3366cc)
 * @param {number} temperature - Light temperature (default: 1 for max warm)
 * @param {number} steps - Number of steps (default: 11)
 */
export function compareModesConsole(baseHex = '#3366cc', temperature = 1, steps = 11) {
  const baseOklch = hexToOklch(baseHex);

  console.group(`🎨 Mode Comparison: ${baseHex} @ temp=${temperature}`);
  console.log(`Base hue: ${baseOklch.H.toFixed(1)}°, Base chroma: ${baseOklch.C.toFixed(3)}`);
  console.log('');

  const conservative = validateHueDeltas(baseHex, temperature, steps, 'conservative');
  console.log('');
  const painterly = validateHueDeltas(baseHex, temperature, steps, 'painterly');

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Conservative - Shadow: ${conservative.darkestDelta.toFixed(1)}°, Highlight: ${conservative.lightestDelta.toFixed(1)}°`);
  console.log(`Painterly    - Shadow: ${painterly.darkestDelta.toFixed(1)}°, Highlight: ${painterly.lightestDelta.toFixed(1)}°`);
  console.log(`Ratio (P/C)  - Shadow: ${(painterly.darkestDelta / conservative.darkestDelta).toFixed(2)}x, Highlight: ${(painterly.lightestDelta / conservative.lightestDelta).toFixed(2)}x`);

  const painterlyLarger = painterly.darkestDelta > conservative.darkestDelta &&
                          painterly.lightestDelta > conservative.lightestDelta;
  console.log(`Painterly > Conservative: ${painterlyLarger ? '✓ PASS' : '✗ FAIL'}`);

  console.groupEnd();

  return { conservative, painterly };
}

/**
 * Convert OKLCH ramp to hex strings
 * @param {Object[]} oklchRamp - Array of OKLCH colors
 * @returns {string[]} Array of hex strings
 */
export function rampToHex(oklchRamp) {
  return oklchRamp.map(oklchToHex);
}
