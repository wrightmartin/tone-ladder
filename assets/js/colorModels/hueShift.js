/**
 * Core hue-shift algorithm for Tone Ladder
 * Generates perceptually uniform tonal ramps with artist-style hue shifts
 */

import {
  hexToOklch,
  oklchToHex,
  clampToSrgbGamut,
  normalizeHue,
  hueDifference,
  oklchToOklab,
  oklabToOklch,
  oklabToLinearRgb
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
    convergenceStrength: 0.45, // highlight convergence toward light anchor
    // Near-neutral temperature study settings
    neutralTintStrength: 0.35,    // multiplier on max tint (subtle for UI greys)
    neutralCurveExponent: 1.5,    // higher = more concentrated at extremes, mid stays grey
    neutralEndpointChromaFloor: 0.008  // smaller floor for subtle endpoints
  },
  painterly: {
    maxHueShift: 38,        // degrees - bold, dramatic artistic shifts
    chromaRetention: 0.28,  // allow strong desaturation for drama
    chromaCurveExponent: 0.8, // slower falloff, keeps saturation longer
    convergenceStrength: 0.85, // stronger convergence for dramatic effect
    // Near-neutral temperature study settings
    neutralTintStrength: 0.65,    // multiplier on max tint (bolder but still grey)
    neutralCurveExponent: 1.15,   // lower = more spread across ladder
    neutralEndpointChromaFloor: 0.012  // slightly higher floor for visible endpoints
  }
};

// Light color anchors as OKLab a/b directions (unit vectors)
// Convergence in OKLab is more stable than hue-angle blending at low chroma
const WARM_ANCHOR_H = 65;  // degrees
const COOL_ANCHOR_H = 205; // degrees
const WARM_ANCHOR_A = Math.cos(WARM_ANCHOR_H * Math.PI / 180); // ~0.42
const WARM_ANCHOR_B = Math.sin(WARM_ANCHOR_H * Math.PI / 180); // ~0.91
const COOL_ANCHOR_A = Math.cos(COOL_ANCHOR_H * Math.PI / 180); // ~-0.91
const COOL_ANCHOR_B = Math.sin(COOL_ANCHOR_H * Math.PI / 180); // ~-0.42

// Convergence chroma threshold: below this, convergence weight fades out
// This prevents forcing hue direction when chroma is too low for it to matter
const CONVERGENCE_CHROMA_MIN = 0.01;
const CONVERGENCE_CHROMA_REF = 0.04;

// Near-neutral temperature study thresholds
// When base chroma is below NEUTRAL_BASE_C_MAX, treat it as a "neutral temperature study"
// where temperature should be the dominant signal (light color theory on greys)
const NEUTRAL_BASE_C_MAX = 0.03;
// Minimum chroma for golden test assertions (below this, hue direction is meaningless)
const VISIBLE_TINT_C_MIN = 0.01;
// Maximum chroma to apply in neutral temperature study (keeps it tasteful)
const NEUTRAL_TINT_C_MAX = 0.035;

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

// Yellow family guardrail - prevents cool-biased yellow highlights from drifting into green/mint
// Yellow family: hues approximately 60°-110° (yellow through yellow-green)
// For these bases under cool light, highlights must not exceed the limit
// Internal limits are set 2-3° below the contract limit (120°) to account for hex quantization noise
const YELLOW_FAMILY_HUE_MIN = 60;
const YELLOW_FAMILY_HUE_MAX = 110;
const YELLOW_HIGHLIGHT_HUE_LIMIT_CONSERVATIVE = 110;  // Tighter for conservative (cream-yellow)
const YELLOW_HIGHLIGHT_HUE_LIMIT_PAINTERLY = 115;     // Slightly looser for painterly

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
 * Apply highlight convergence in OKLab space (more stable than hue-angle blending)
 *
 * Instead of blending hue angles (which is unstable at low chroma), we blend
 * the a/b coordinates toward an anchor direction. This keeps L fixed and
 * smoothly moves the color toward the light anchor without hue flips.
 *
 * @param {Object} oklch - Color in OKLCH { L, C, H }
 * @param {number} anchorA - Anchor direction a component (unit vector)
 * @param {number} anchorB - Anchor direction b component (unit vector)
 * @param {number} weight - Blend weight 0-1
 * @returns {Object} Blended color in OKLCH { L, C, H }
 */
function convergeInOklab(oklch, anchorA, anchorB, weight) {
  if (weight <= 0 || oklch.C <= 0) return oklch;

  // Convert to OKLab
  const oklab = oklchToOklab(oklch);

  // Scale anchor direction to match current chroma magnitude
  // This preserves the chroma level while shifting the hue direction
  const targetA = anchorA * oklch.C;
  const targetB = anchorB * oklch.C;

  // Blend a/b toward anchor direction
  const newA = oklab.a + (targetA - oklab.a) * weight;
  const newB = oklab.b + (targetB - oklab.b) * weight;

  // Convert back to OKLCH
  return oklabToOklch({ L: oklab.L, a: newA, b: newB });
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

  // Enforce strict monotonicity in lightness values BEFORE clamping
  // This ensures ramp order is stable by construction, avoiding post-clamp L nudges
  const L_EPSILON = 0.002; // Minimum L step between adjacent values
  for (let i = 1; i < steps; i++) {
    if (lightnessValues[i] <= lightnessValues[i - 1]) {
      lightnessValues[i] = Math.min(L_MAX, lightnessValues[i - 1] + L_EPSILON);
    }
  }

  // Detect near-neutral base for temperature study treatment
  const isNeutralBase = baseOklch.C <= NEUTRAL_BASE_C_MAX;

  // Generate the ramp
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const L = lightnessValues[i];

    // Calculate position relative to midpoint (-1 to +1)
    // Negative = darker than base, Positive = lighter than base
    const relativePosition = (i - midIndex) / midIndex;

    let H, C;

    // === NEAR-NEUTRAL TEMPERATURE STUDY BRANCH ===
    // For near-neutral bases with temperature, create tint from scratch using anchors
    // This implements "light color theory on greys": warm light creates warm highlights
    // and cool shadows; cool light creates the opposite.
    if (isNeutralBase && temperature !== 0) {
      // Determine anchor direction based on temperature and position
      // Warm light: highlights -> warm (65°), shadows -> cool (205°)
      // Cool light: highlights -> cool (205°), shadows -> warm (65°)
      const isHighlight = relativePosition > 0;
      const isWarmLight = temperature > 0;

      let anchorA, anchorB;
      if (isWarmLight) {
        anchorA = isHighlight ? WARM_ANCHOR_A : COOL_ANCHOR_A;
        anchorB = isHighlight ? WARM_ANCHOR_B : COOL_ANCHOR_B;
      } else {
        anchorA = isHighlight ? COOL_ANCHOR_A : WARM_ANCHOR_A;
        anchorB = isHighlight ? COOL_ANCHOR_B : WARM_ANCHOR_B;
      }

      // Chroma curve for neutrals: peaks at extremes, minimal at midpoint
      // This creates the temperature study effect where shadows and highlights are tinted
      // but the midtones remain relatively neutral
      const absPos = Math.abs(relativePosition);
      const tempStrength = Math.abs(temperature);

      // Mode-aware curve: higher exponent = more concentrated at extremes
      // Conservative uses higher exponent so mid stays closer to pure grey
      // Painterly uses lower exponent for more spread across the ladder
      const curveExponent = config.neutralCurveExponent;
      const tintStrength = config.neutralTintStrength;

      // Smooth chroma ramp: starts at 0 at midpoint, rises toward extremes
      // Power curve controls how quickly tint builds from center
      const chromaWeight = Math.pow(absPos, curveExponent) * tempStrength * tintStrength;

      // Calculate target chroma: scale between 0 and max tint
      // Mode strength already applied via tintStrength
      C = chromaWeight * NEUTRAL_TINT_C_MAX;

      // Calculate H from anchor direction
      H = normalizeHue(Math.atan2(anchorB, anchorA) * (180 / Math.PI));

    } else {
      // === STANDARD BRANCH (non-neutral or neutral with temp=0) ===

      // Calculate target chroma FIRST (needed for hue stability check)
      const targetChroma = calculateChroma(baseOklch.C, relativePosition, config);

      // Calculate biased hue toward anchor
      // Warm light: highlights -> warm anchor (65°), shadows -> cool anchor (205°)
      // Cool light: opposite
      // Convert maxShift (degrees) to blend weight (0-1 scale)
      const maxBlendWeight = maxShift / 90;
      const rawBiasedHue = calculateBiasedHue(
        baseOklch.H,
        relativePosition,
        temperature,
        maxBlendWeight
      );

      // Apply hue stability damping when chroma is low
      // Blend between base hue and biased hue based on stability factor
      const stabilityFactor = getHueStabilityFactor(targetChroma);
      H = blendHueDegrees(baseOklch.H, rawBiasedHue, stabilityFactor);

      // Calculate chroma with highlight falloff
      // This collapses chroma toward white, preventing saturated highlights
      const highlightFactor = Math.max(0, relativePosition);
      const highlightChromaFalloff = 1 - Math.pow(highlightFactor, 2.2);
      C = targetChroma * highlightChromaFalloff;

      // Apply highlight convergence in OKLab space (more stable than hue-angle blending)
      // Only for highlights (relativePosition > 0) and when temperature !== 0
      if (relativePosition > 0 && temperature !== 0) {
        const highlightPosition = relativePosition;

        // Base convergence weight: kicks in near the top third, scales with temperature
        const wPos = smoothstep(0.6, 1.0, highlightPosition);
        const wTemp = Math.pow(Math.abs(temperature), 0.7);
        let w = wPos * wTemp * config.convergenceStrength;

        // Scale weight down as chroma collapses - don't force hue when C is tiny
        // This is the key fix: no hue manipulation when there's no chroma to shift
        const chromaFade = smoothstep(CONVERGENCE_CHROMA_MIN, CONVERGENCE_CHROMA_REF, C);
        w *= chromaFade;

        if (w > 0.001) {
          // Choose anchor direction based on temperature sign
          const anchorA = temperature > 0 ? WARM_ANCHOR_A : COOL_ANCHOR_A;
          const anchorB = temperature > 0 ? WARM_ANCHOR_B : COOL_ANCHOR_B;

          // Converge in OKLab space - stable even at low chroma
          const converged = convergeInOklab({ L, C, H }, anchorA, anchorB, w);
          H = converged.H;
          C = converged.C;
        }
      }

      // Yellow family guardrail: prevent cool-biased yellow highlights from drifting into green/mint
      // Applies only when: temp < 0, base is yellow family, and we're in top 3 highlights
      const isYellowFamily = baseOklch.H >= YELLOW_FAMILY_HUE_MIN && baseOklch.H <= YELLOW_FAMILY_HUE_MAX;
      const isTop3Highlight = i >= steps - 3;
      if (isYellowFamily && temperature < 0 && isTop3Highlight) {
        const hueLimit = mode === 'conservative'
          ? YELLOW_HIGHLIGHT_HUE_LIMIT_CONSERVATIVE
          : YELLOW_HIGHLIGHT_HUE_LIMIT_PAINTERLY;
        if (H > hueLimit && H < 180) {  // Only clamp if drifting into green (not wrapping around)
          H = hueLimit;
        }
      }
    }

    // Enforce chroma floor at extreme endpoints when temperature !== 0
    // This guarantees tinted endpoints (no neutral grey) per behaviour contract
    const isEndpoint = (i === 0 || i === steps - 1);
    if (isEndpoint && temperature !== 0) {
      // For neutral bases, use mode-specific floor (smaller for conservative)
      // For non-neutrals, use standard floor
      const baseFloor = isNeutralBase
        ? config.neutralEndpointChromaFloor
        : 0.015;
      const chromaFloor = baseFloor * Math.abs(temperature);
      C = Math.max(C, chromaFloor);
    }

    // Gamut clamp: reduce chroma to fit sRGB while preserving L and H
    // Monotonicity is enforced earlier in lightnessValues, so no post-clamp L nudging needed
    const clamped = clampToSrgbGamut({ L, C, H });

    ramp.push(clamped);
  }

  return ramp;
}

/**
 * Calculate biased hue for a given position in the ramp
 *
 * Uses anchor-bias approach (not rotation around base hue):
 * - Warm light (+temp): highlights bias toward warm anchor (65°), shadows toward cool anchor (205°)
 * - Cool light (-temp): highlights bias toward cool anchor, shadows toward warm anchor
 * - At midpoint (relativePosition === 0): hue remains the base hue
 *
 * @param {number} baseHue - Base color hue in degrees
 * @param {number} relativePosition - Position in ramp (-1 to +1)
 * @param {number} temperature - Light temperature (-1 to +1)
 * @param {number} maxBlendWeight - Maximum blend weight toward anchor (0-1)
 * @returns {number} Final hue in degrees (0-360)
 */
function calculateBiasedHue(baseHue, relativePosition, temperature, maxBlendWeight) {
  if (temperature === 0 || relativePosition === 0) return normalizeHue(baseHue);

  // Determine which anchor to bias toward based on position and temperature
  // Warm light: highlights -> warm (65°), shadows -> cool (205°)
  // Cool light: highlights -> cool (205°), shadows -> warm (65°)
  const isHighlight = relativePosition > 0;
  const isWarmLight = temperature > 0;

  let anchorHue;
  if (isWarmLight) {
    anchorHue = isHighlight ? WARM_ANCHOR_H : COOL_ANCHOR_H;
  } else {
    anchorHue = isHighlight ? COOL_ANCHOR_H : WARM_ANCHOR_H;
  }

  // Blend weight scales with:
  // - distance from midpoint (raised to power for ease-in)
  // - temperature strength (mapped through response curve)
  const positionWeight = Math.pow(Math.abs(relativePosition), 1.1);
  const tempStrength = Math.abs(mapTemperature(temperature));
  const blendWeight = positionWeight * tempStrength * maxBlendWeight;

  // Blend toward anchor via shortest arc
  return blendHueDegrees(baseHue, anchorHue, blendWeight);
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

/**
 * Check if an OKLCH color is strictly in sRGB gamut (no tolerance)
 * @param {Object} oklch - Color in OKLCH format
 * @returns {boolean} True if in gamut
 */
function isInGamut(oklch) {
  const oklab = oklchToOklab(oklch);
  const linear = oklabToLinearRgb(oklab);
  return linear.r >= 0 && linear.r <= 1 &&
         linear.g >= 0 && linear.g <= 1 &&
         linear.b >= 0 && linear.b <= 1;
}

/**
 * Check if OKLCH color would require per-channel clipping when converted to hex
 * This indicates the gamut clamping didn't fully work
 * @param {Object} oklch - Color in OKLCH format
 * @returns {{needsClip: boolean, channels: string[]}} Clipping info
 */
function wouldRequireClipping(oklch) {
  const oklab = oklchToOklab(oklch);
  const linear = oklabToLinearRgb(oklab);
  const channels = [];
  if (linear.r < 0 || linear.r > 1) channels.push('R');
  if (linear.g < 0 || linear.g > 1) channels.push('G');
  if (linear.b < 0 || linear.b > 1) channels.push('B');
  return { needsClip: channels.length > 0, channels };
}

/**
 * Debug helper: Generate ramp with gamut mapping logging
 * Shows before/after for each step to diagnose hue wobble
 *
 * @param {string} baseHex - Base color as hex
 * @param {number} temperature - Light temperature
 * @param {number} steps - Number of steps
 * @param {string} mode - 'conservative' or 'painterly'
 */
export function debugGamutMapping(baseHex, temperature, steps, mode) {
  const baseOklch = hexToOklch(baseHex);
  const config = MODE_CONFIG[mode] || MODE_CONFIG.painterly;
  const maxShift = config.maxHueShift;
  const midIndex = Math.floor(steps / 2);
  const clippingIssues = [];

  console.group(`Gamut Mapping Debug: ${baseHex} @ temp=${temperature} (${mode})`);
  console.log('Step | Before L/C/H | In Gamut? | After L/C/H | dC | dH');
  console.log('-----|--------------|-----------|-------------|-----|----');

  // Simplified ramp generation with logging
  const lightnessValues = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    lightnessValues.push(L_MIN + t * (L_MAX - L_MIN));
  }

  const baseLightness = Math.max(L_MIN, Math.min(L_MAX, baseOklch.L));
  const midLightness = lightnessValues[midIndex];
  const lightnessOffset = baseLightness - midLightness;

  for (let i = 0; i < steps; i++) {
    const L = Math.max(L_MIN, Math.min(L_MAX, lightnessValues[i] + lightnessOffset));
    const relativePosition = (i - midIndex) / midIndex;

    // Calculate chroma
    const targetChroma = calculateChroma(baseOklch.C, relativePosition, config);
    const highlightFactor = Math.max(0, relativePosition);
    const highlightChromaFalloff = 1 - Math.pow(highlightFactor, 2.2);
    const C = targetChroma * highlightChromaFalloff;

    // Calculate hue with stability damping
    const rawHueShift = calculateHueShift(baseOklch.H, relativePosition, temperature, maxShift);
    const stabilityFactor = getHueStabilityFactor(C);
    const hueShift = rawHueShift * stabilityFactor;
    const H = normalizeHue(baseOklch.H + hueShift);

    const before = { L, C, H };
    const inGamut = isInGamut(before);
    const after = clampToSrgbGamut(before);
    const clipInfo = wouldRequireClipping(after);

    const deltaC = (after.C - before.C).toFixed(4);
    const deltaH = hueDifference(before.H, after.H).toFixed(1);
    const clipFlag = clipInfo.needsClip ? `CLIP:${clipInfo.channels.join('')}` : '';

    const label = i < midIndex ? 'shd' : i === midIndex ? 'BASE' : 'hlt';
    console.log(
      `${String(i).padStart(4)} | L=${before.L.toFixed(3)} C=${before.C.toFixed(4)} H=${before.H.toFixed(1).padStart(5)} | ` +
      `${inGamut ? '  Y  ' : '  N  '} | ` +
      `L=${after.L.toFixed(3)} C=${after.C.toFixed(4)} H=${after.H.toFixed(1).padStart(5)} | ` +
      `${deltaC} | ${deltaH} [${label}] ${clipFlag}`
    );

    if (clipInfo.needsClip) {
      clippingIssues.push({ step: i, channels: clipInfo.channels });
    }
  }

  console.log('---');
  if (clippingIssues.length === 0) {
    console.log('No per-channel clipping detected - gamut mapping is safe');
  } else {
    console.log(`${clippingIssues.length} step(s) would require clipping:`);
    clippingIssues.forEach(({ step, channels }) => {
      console.log(`   Step ${step}: ${channels.join(', ')} out of [0,1]`);
    });
  }

  console.groupEnd();
}

/**
 * Debug helper: Verify highlight hue stability across test cases
 * Checks for unexpected hue jumps in the top 3 highlight steps
 *
 * A "hue jump" is when adjacent steps change hue direction unexpectedly
 * (e.g., going from +10deg to -5deg shift between adjacent highlights)
 *
 * @param {string} baseHex - Base color to test (default: #2F6FED)
 * @returns {Object} Test results with pass/fail status
 */
/**
 * Debug helper: Print per-step H, Δh from base, and shadow/highlight label
 * Plus summary of average Δh sign for shadows vs highlights
 *
 * @param {string} baseHex - Base color as hex
 * @param {number} temperature - Light temperature (-1 to +1)
 * @param {number} steps - Number of steps (9 or 11)
 * @param {string} mode - 'conservative' or 'painterly'
 */
export function debugHueShifts(baseHex, temperature, steps, mode) {
  const baseOklch = hexToOklch(baseHex);
  const ramp = generateOklchRamp(baseOklch, temperature, steps, mode);
  const midIndex = Math.floor(steps / 2);
  const baseHue = baseOklch.H;

  const shadowDeltas = [];
  const highlightDeltas = [];

  console.log('');
  console.log(`=== Debug Hue Shifts ===`);
  console.log(`Base: ${baseHex} | H: ${baseHue.toFixed(1)}°`);
  console.log(`Temp: ${temperature > 0 ? '+' : ''}${temperature} | Steps: ${steps} | Mode: ${mode}`);
  console.log('');
  console.log('Step | H        | Δh from base | Label');
  console.log('-----|----------|--------------|----------');

  ramp.forEach((color, i) => {
    const delta = hueDifference(baseHue, color.H);
    let label;

    if (i < midIndex) {
      label = 'shadow';
      shadowDeltas.push(delta);
    } else if (i === midIndex) {
      label = 'BASE';
    } else {
      label = 'highlight';
      highlightDeltas.push(delta);
    }

    const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°';
    console.log(
      `  ${String(i).padStart(2)} | ${color.H.toFixed(1).padStart(6)}° | ${deltaStr.padStart(12)} | ${label}`
    );
  });

  // Summary: average Δh sign for shadows vs highlights
  const avgShadowDelta = shadowDeltas.length > 0
    ? shadowDeltas.reduce((a, b) => a + b, 0) / shadowDeltas.length
    : 0;
  const avgHighlightDelta = highlightDeltas.length > 0
    ? highlightDeltas.reduce((a, b) => a + b, 0) / highlightDeltas.length
    : 0;

  const shadowSign = avgShadowDelta > 0 ? 'positive (+)' : avgShadowDelta < 0 ? 'negative (-)' : 'neutral (0)';
  const highlightSign = avgHighlightDelta > 0 ? 'positive (+)' : avgHighlightDelta < 0 ? 'negative (-)' : 'neutral (0)';

  console.log('');
  console.log('=== Summary ===');
  console.log(`Shadows avg Δh:    ${avgShadowDelta >= 0 ? '+' : ''}${avgShadowDelta.toFixed(1)}° -> ${shadowSign}`);
  console.log(`Highlights avg Δh: ${avgHighlightDelta >= 0 ? '+' : ''}${avgHighlightDelta.toFixed(1)}° -> ${highlightSign}`);
  console.log('');

  return {
    baseHex,
    baseHue,
    temperature,
    steps,
    mode,
    shadowDeltas,
    highlightDeltas,
    avgShadowDelta,
    avgHighlightDelta
  };
}

export function debugHighlightStability(baseHex = '#2F6FED') {
  const testCases = [
    { temp: 0.9, steps: 9, mode: 'conservative' },
    { temp: 0.9, steps: 11, mode: 'conservative' },
    { temp: -0.9, steps: 9, mode: 'conservative' },
    { temp: -0.9, steps: 11, mode: 'conservative' },
    { temp: 0.9, steps: 9, mode: 'painterly' },
    { temp: 0.9, steps: 11, mode: 'painterly' },
    { temp: -0.9, steps: 9, mode: 'painterly' },
    { temp: -0.9, steps: 11, mode: 'painterly' }
  ];

  const baseOklch = hexToOklch(baseHex);
  const results = [];
  let allPass = true;

  console.group(`Highlight Stability Test: ${baseHex}`);
  console.log(`Base hue: ${baseOklch.H.toFixed(1)} | Base chroma: ${baseOklch.C.toFixed(3)}`);
  console.log('');

  for (const tc of testCases) {
    const ramp = generateOklchRamp(baseOklch, tc.temp, tc.steps, tc.mode);
    const midIndex = Math.floor(tc.steps / 2);

    // Get highlight steps (last 3)
    const highlightSteps = ramp.slice(-3);
    const highlightDeltas = highlightSteps.map(c => hueDifference(baseOklch.H, c.H));

    // Check for sign flips or large jumps between adjacent highlights
    let hasJump = false;
    let jumpDetails = '';
    for (let i = 1; i < highlightDeltas.length; i++) {
      const prev = highlightDeltas[i - 1];
      const curr = highlightDeltas[i];
      // Sign flip (excluding near-zero values)
      if (Math.abs(prev) > 2 && Math.abs(curr) > 2 && Math.sign(prev) !== Math.sign(curr)) {
        hasJump = true;
        jumpDetails = `sign flip at step ${tc.steps - 3 + i}: ${prev.toFixed(1)} -> ${curr.toFixed(1)}`;
      }
      // Large delta change (>15 degrees between adjacent highlights)
      const deltaChange = Math.abs(curr - prev);
      if (deltaChange > 15) {
        hasJump = true;
        jumpDetails = `large jump at step ${tc.steps - 3 + i}: ${deltaChange.toFixed(1)} deg`;
      }
    }

    const pass = !hasJump;
    if (!pass) allPass = false;

    const tempLabel = tc.temp > 0 ? `+${tc.temp}` : `${tc.temp}`;
    const status = pass ? 'PASS' : 'FAIL';
    console.log(
      `${status} | temp=${tempLabel} steps=${tc.steps} ${tc.mode.padEnd(12)} | ` +
      `highlights: [${highlightDeltas.map(d => (d >= 0 ? '+' : '') + d.toFixed(1)).join(', ')}]` +
      (jumpDetails ? ` <- ${jumpDetails}` : '')
    );

    results.push({
      ...tc,
      pass,
      highlightDeltas,
      jumpDetails
    });
  }

  console.log('');
  console.log(allPass ? 'All tests passed - no hue jumps detected' : 'Some tests failed - hue jumps detected');
  console.groupEnd();

  return { allPass, results, baseHex };
}
