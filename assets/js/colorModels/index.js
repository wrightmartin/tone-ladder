/**
 * Tone Ladder Color Algorithm - Public API
 *
 * Generates hue-shift tonal ramps where warm light creates cool shadows
 * (and vice versa), producing artist-style color relationships.
 */

import { hexToOklch } from './convert.js';
import { generateOklchRamp, rampToHex, validateHueDeltas, compareModesConsole, debugGamutMapping, debugHighlightStability, debugHueShifts } from './hueShift.js';

// Default values
const DEFAULT_BASE_HEX = '#2F6FED';
const DEFAULT_TEMPERATURE = 0.6; // warm enough to show >=8 hue shift in painterly mode
const DEFAULT_STEPS = 9;
const DEFAULT_MODE = 'painterly';

/**
 * Generate a tonal ramp with hue shifts based on light temperature
 *
 * @param {string} baseHex - 6-digit hex string (with or without #), default #2F6FED
 * @param {number} temperature - Light temperature: -1.0 (cool) to +1.0 (warm), default 0.6
 * @param {number} steps - Number of steps: 9 or 11, default 9
 * @param {string} mode - 'conservative' or 'painterly', default 'painterly'
 * @returns {string[]} Array of hex strings ordered darkest to lightest
 */
export function generateRamp(
  baseHex = DEFAULT_BASE_HEX,
  temperature = DEFAULT_TEMPERATURE,
  steps = DEFAULT_STEPS,
  mode = DEFAULT_MODE
) {
  // Normalize hex input
  const normalizedHex = normalizeHex(baseHex);

  // Validate inputs
  validateInputs(normalizedHex, temperature, steps, mode);

  // Convert to OKLCH
  const baseOklch = hexToOklch(normalizedHex);

  // Generate ramp in OKLCH space
  const oklchRamp = generateOklchRamp(baseOklch, temperature, steps, mode);
  
  // Convert to hex and return
  return rampToHex(oklchRamp);
}

/**
 * Normalize hex input to consistent format
 */
function normalizeHex(hex) {
  let cleaned = String(hex).trim();

  // Add # if missing
  if (!cleaned.startsWith('#')) {
    cleaned = '#' + cleaned;
  }

  // Validate format
  if (!/^#[0-9A-Fa-f]{6}$/.test(cleaned)) {
    throw new Error(`Invalid hex color: ${hex}. Expected 6-digit hex (e.g., #2F6FED)`);
  }

  return cleaned.toUpperCase();
}

/**
 * Validate all inputs
 */
function validateInputs(hex, temperature, steps, mode) {
  // Temperature must be -1 to +1
  if (typeof temperature !== 'number' || temperature < -1 || temperature > 1) {
    throw new Error(`Invalid temperature: ${temperature}. Expected number between -1 and +1`);
  }

  // Steps must be 9 or 11
  if (steps !== 9 && steps !== 11) {
    throw new Error(`Invalid steps: ${steps}. Expected 9 or 11`);
  }

  // Mode must be conservative or painterly
  if (mode !== 'conservative' && mode !== 'painterly') {
    throw new Error(`Invalid mode: ${mode}. Expected 'conservative' or 'painterly'`);
  }
}

/**
 * Validation helper for development - logs hue deltas to console
 * Use to verify painterly mode produces >=8 degree shifts at extremes
 *
 * @param {string} baseHex - Base color as hex
 * @param {number} temperature - Light temperature
 * @param {number} steps - Number of steps
 * @param {string} mode - 'conservative' or 'painterly'
 * @returns {Object} Validation results including deltas and pass/fail status
 */
export function validateRamp(
  baseHex = DEFAULT_BASE_HEX,
  temperature = DEFAULT_TEMPERATURE,
  steps = DEFAULT_STEPS,
  mode = DEFAULT_MODE
) {
  const normalizedHex = normalizeHex(baseHex);
  return validateHueDeltas(normalizedHex, temperature, steps, mode);
}

/**
 * Compare Conservative vs Painterly modes side-by-side
 * Logs summary to console showing hue deltas for both modes
 *
 * @param {string} baseHex - Base color as hex (default: #3366cc)
 * @param {number} temperature - Light temperature (default: 1 for max warm)
 * @param {number} steps - Number of steps (default: 11)
 * @returns {Object} Results for both modes
 */
export function compareModes(
  baseHex = '#3366cc',
  temperature = 1,
  steps = 11
) {
  return compareModesConsole(baseHex, temperature, steps);
}

/**
 * Debug helper: Log gamut mapping before/after for each step
 * Use to diagnose hue wobble issues
 */
export function debugGamut(
  baseHex = '#2F6FED',
  temperature = 1,
  steps = 11,
  mode = 'painterly'
) {
  debugGamutMapping(baseHex, temperature, steps, mode);
}

/**
 * Debug helper: Verify highlight hue stability across test cases
 * Checks for unexpected hue jumps in the top 3 highlight steps
 * Tests at temp ±0.9, steps 9 and 11, both modes
 *
 * Run in console: ToneLadder.debugHighlights('#2F6FED')
 */
export function debugHighlights(baseHex = '#2F6FED') {
  return debugHighlightStability(baseHex);
}

/**
 * Debug helper: Print per-step H, Δh from base, and shadow/highlight label
 * Plus summary of average Δh sign for shadows vs highlights
 *
 * Run in console: ToneLadder.debugHue('#2F6FED', 1, 9, 'painterly')
 *
 * @param {string} baseHex - Base color as hex
 * @param {number} temperature - Light temperature (-1 to +1)
 * @param {number} steps - Number of steps (9 or 11)
 * @param {string} mode - 'conservative' or 'painterly'
 */
export function debugHue(
  baseHex = DEFAULT_BASE_HEX,
  temperature = DEFAULT_TEMPERATURE,
  steps = DEFAULT_STEPS,
  mode = DEFAULT_MODE
) {
  return debugHueShifts(baseHex, temperature, steps, mode);
}

// Export defaults for reference
export const defaults = {
  baseHex: DEFAULT_BASE_HEX,
  temperature: DEFAULT_TEMPERATURE,
  steps: DEFAULT_STEPS,
  mode: DEFAULT_MODE
};
