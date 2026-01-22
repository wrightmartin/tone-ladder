/**
 * Color conversion utilities for Tone Ladder
 * Converts between hex, sRGB, linear RGB, XYZ, OKLab, and OKLCH color spaces
 */

// --- Hex <-> sRGB ---

export function hexToSrgb(hex) {
  const cleaned = hex.replace(/^#/, '');
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export function srgbToHex(srgb) {
  const toHex = (val) => {
    const clamped = Math.max(0, Math.min(1, val));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, '0');
  };
  return '#' + toHex(srgb.r) + toHex(srgb.g) + toHex(srgb.b);
}

// --- sRGB <-> Linear RGB ---

function srgbToLinear(val) {
  if (val <= 0.04045) {
    return val / 12.92;
  }
  return Math.pow((val + 0.055) / 1.055, 2.4);
}

function linearToSrgb(val) {
  if (val <= 0.0031308) {
    return val * 12.92;
  }
  return 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(srgb) {
  return {
    r: srgbToLinear(srgb.r),
    g: srgbToLinear(srgb.g),
    b: srgbToLinear(srgb.b)
  };
}

export function linearRgbToSrgb(linear) {
  return {
    r: linearToSrgb(linear.r),
    g: linearToSrgb(linear.g),
    b: linearToSrgb(linear.b)
  };
}

// --- Linear RGB <-> OKLab (direct conversion) ---

export function linearRgbToOklab(linear) {
  const l = 0.4122214708 * linear.r + 0.5363325363 * linear.g + 0.0514459929 * linear.b;
  const m = 0.2119034982 * linear.r + 0.6806995451 * linear.g + 0.1073969566 * linear.b;
  const s = 0.0883024619 * linear.r + 0.2817188376 * linear.g + 0.6299787005 * linear.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  };
}

export function oklabToLinearRgb(oklab) {
  const l_ = oklab.L + 0.3963377774 * oklab.a + 0.2158037573 * oklab.b;
  const m_ = oklab.L - 0.1055613458 * oklab.a - 0.0638541728 * oklab.b;
  const s_ = oklab.L - 0.0894841775 * oklab.a - 1.2914855480 * oklab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  };
}

// --- OKLab <-> OKLCH ---

export function oklabToOklch(oklab) {
  const C = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
  let H = Math.atan2(oklab.b, oklab.a) * (180 / Math.PI);
  if (H < 0) H += 360;
  return {
    L: oklab.L,
    C: C,
    H: H
  };
}

export function oklchToOklab(oklch) {
  const hRad = oklch.H * (Math.PI / 180);
  return {
    L: oklch.L,
    a: oklch.C * Math.cos(hRad),
    b: oklch.C * Math.sin(hRad)
  };
}

// --- Convenience: Hex <-> OKLCH ---

export function hexToOklch(hex) {
  const srgb = hexToSrgb(hex);
  const linear = srgbToLinearRgb(srgb);
  const oklab = linearRgbToOklab(linear);
  return oklabToOklch(oklab);
}

export function oklchToHex(oklch) {
  const oklab = oklchToOklab(oklch);
  const linear = oklabToLinearRgb(oklab);
  const srgb = linearRgbToSrgb(linear);
  return srgbToHex(srgb);
}

// --- Utility: Clamp OKLCH to sRGB gamut ---

export function clampToSrgbGamut(oklch) {
  const oklab = oklchToOklab(oklch);
  const linear = oklabToLinearRgb(oklab);

  // Check if in gamut
  const inGamut = linear.r >= -0.0001 && linear.r <= 1.0001 &&
                  linear.g >= -0.0001 && linear.g <= 1.0001 &&
                  linear.b >= -0.0001 && linear.b <= 1.0001;

  if (inGamut) {
    return oklch;
  }

  // Binary search to find maximum chroma in gamut
  let low = 0;
  let high = oklch.C;

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const testOklab = oklchToOklab({ L: oklch.L, C: mid, H: oklch.H });
    const testLinear = oklabToLinearRgb(testOklab);

    const testInGamut = testLinear.r >= -0.0001 && testLinear.r <= 1.0001 &&
                        testLinear.g >= -0.0001 && testLinear.g <= 1.0001 &&
                        testLinear.b >= -0.0001 && testLinear.b <= 1.0001;

    if (testInGamut) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return { L: oklch.L, C: low, H: oklch.H };
}

// --- Utility: Normalize hue to 0-360 ---

export function normalizeHue(h) {
  h = h % 360;
  if (h < 0) h += 360;
  return h;
}

// --- Utility: Calculate hue difference (shortest path) ---

export function hueDifference(h1, h2) {
  const diff = normalizeHue(h2 - h1);
  return diff > 180 ? diff - 360 : diff;
}
