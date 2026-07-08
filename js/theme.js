// theme.js — the sky clock.
//
// The page background follows the sun at the searched location: deep night,
// indigo first light, rose horizon, sunrise gold, pale midday blue, long
// afternoon, golden hour, sunset orange, dusk violet, back to night. Weather
// lays a tint over the sky color (gray overcast, blue-gray rain, pale fog…)
// without replacing it — the time of day always shows through. Text colors
// are derived from the final background luminance so contrast holds at every
// minute of the day. The accent color still comes from the temperature mood
// (classifyMood), so heat stays warm-toned and cold stays cool-toned.
//
// Plain sRGB hex interpolation throughout — no libraries.

import { classifyMood } from './feelslike.js';

/* ---------- color kit ---------- */

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A.map((v, i) => v + (B[i] - v) * t));
}

// WCAG relative luminance, 0 (black) – 1 (white)
export function luminance(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const rgba = (hex, a) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/* ---------- the sky ---------- */

const NIGHT_BG = '#0d1426';
const NIGHT_GLOW = '#1c2542';

// [minute-of-day, background, glow] keyframes, assembled around the
// location's actual sunrise (r) and sunset (s), then interpolated linearly.
// The glow feeds the --haze radial wash in the page corner.
function skyStops(r, s) {
  const noon = (r + s) / 2;
  return [
    [0, NIGHT_BG, NIGHT_GLOW],
    [r - 100, NIGHT_BG, NIGHT_GLOW],   // flat night until first light
    [r - 45, '#3b3457', '#5a4a6e'],    // indigo first light
    [r - 12, '#8c5d6e', '#c07a6a'],    // rose horizon
    [r + 10, '#e9a066', '#f6c07c'],    // sunrise gold
    [r + 60, '#f2d9a8', '#f9e6b8'],    // early morning
    [r + 150, '#e9ecdc', '#f4f0d8'],   // morning settles
    [noon, '#dfeaf0', '#eef4f4'],      // solar noon, palest blue
    [s - 150, '#e7e9d8', '#f2ecd0'],   // long afternoon
    [s - 55, '#f0cf96', '#f7d99a'],    // golden hour
    [s - 8, '#eb9f63', '#f2b070'],     // sunset
    [s + 30, '#8a5f7d', '#a76e83'],    // afterglow
    [s + 70, '#463f6b', '#584f7d'],    // dusk violet
    [s + 130, NIGHT_BG, NIGHT_GLOW],   // nightfall
    [1440, NIGHT_BG, NIGHT_GLOW],
  ];
}

export function skyColors(minute, sunriseMin, sunsetMin) {
  // Drop any stop that doesn't advance the clock (degenerate at extreme
  // latitudes where the anchors collide), so interpolation never divides by 0.
  const stops = skyStops(sunriseMin, sunsetMin)
    .filter((stop, i, arr) => i === 0 || stop[0] > arr[i - 1][0]);
  const m = Math.max(0, Math.min(1440, minute));
  for (let i = 0; i < stops.length - 1; i++) {
    const [m0, bg0, glow0] = stops[i];
    const [m1, bg1, glow1] = stops[i + 1];
    if (m >= m0 && m <= m1) {
      const t = (m - m0) / (m1 - m0);
      return { bg: mix(bg0, bg1, t), glow: mix(glow0, glow1, t) };
    }
  }
  return { bg: NIGHT_BG, glow: NIGHT_GLOW };
}

/* ---------- weather tint ---------- */

// A tint color and a mix strength per WMO weather-code family. Strengths are
// deliberately capped well under half so the sky color stays in charge.
export function weatherTint(code, cloudCover, isDay) {
  let tint = null, amt = 0;
  if (code >= 95) { tint = '#525b68'; amt = 0.42; }                                              // thunderstorm
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) { tint = '#dfe5ec'; amt = 0.34; } // snow
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) { tint = '#6f8092'; amt = 0.36; } // rain
  else if (code >= 51 && code <= 57) { tint = '#8b98a3'; amt = 0.26; }                           // drizzle
  else if (code === 45 || code === 48) { tint = '#c2c6c3'; amt = 0.40; }                         // fog
  else if (code === 3) { tint = '#9aa0a2'; amt = 0.30; }                                         // overcast
  else if (code === 2) { tint = '#a9adaa'; amt = 0.14; }                                         // partly cloudy
  else if (cloudCover > 60) { tint = '#9aa0a2'; amt = (cloudCover / 100) * 0.22; }
  if (!tint) return null;
  if (!isDay) amt *= 0.55; // weather reads dimmer in the dark
  return { tint, amt };
}

/* ---------- temperature accent ---------- */

// [on light background, on dark background] per mood.
const ACCENTS = {
  'dry-heat': ['#b5490f', '#e0762f'],
  'humid-heat': ['#55742e', '#8fb04c'],
  warm: ['#c07f1f', '#d9a244'],
  mild: ['#58855f', '#7fae86'],
  chill: ['#3a6f8f', '#6fa7c7'],
  cold: ['#2f5e9e', '#6f9fdb'],
};

/* ---------- apply ---------- */

const isoMinutes = (iso) =>
  iso ? parseInt(iso.slice(11, 13), 10) * 60 + parseInt(iso.slice(14, 16), 10) : null;

/**
 * Compute the palette and set it as CSS variables on <html>, overriding the
 * static :root fallback in style.css. All inputs optional — the defaults give
 * a clear day at the browser's local time (used by the empty state and the
 * changelog page). ISO times are the location's local wall clock, exactly as
 * Open-Meteo returns them with timezone=auto.
 */
export function applyTheme({
  timeISO, sunriseISO, sunsetISO,
  weatherCode = 0, cloudCover = 0, isDay,
  feelsLike = 65, dewPoint = 45,
} = {}) {
  const now = new Date();
  const minute = isoMinutes(timeISO) ?? now.getHours() * 60 + now.getMinutes();
  const sunrise = isoMinutes(sunriseISO) ?? 390;  // 6:30am fallback
  const sunset = isoMinutes(sunsetISO) ?? 1185;   // 7:45pm fallback

  let { bg, glow } = skyColors(minute, sunrise, sunset);
  const day = isDay != null ? !!isDay : (minute > sunrise && minute < sunset);
  const w = weatherTint(weatherCode, cloudCover, day);
  if (w) {
    bg = mix(bg, w.tint, w.amt);
    glow = mix(glow, w.tint, w.amt * 0.6);
  }

  const lightBg = luminance(bg) > 0.32;
  const ink = lightBg ? mix('#241f18', bg, 0.10) : mix('#f5f1e6', bg, 0.12);
  const mood = classifyMood(feelsLike, dewPoint);

  const vars = {
    '--bg': bg,
    '--ink': ink,
    '--muted': mix(ink, bg, 0.42),
    '--line': mix(ink, bg, 0.70),
    '--accent': ACCENTS[mood][lightBg ? 0 : 1],
    '--haze': rgba(glow, 0.55),
  };
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v);
  }
  document.body.dataset.mood = mood;
  if (lightBg) delete document.body.dataset.night;
  else document.body.dataset.night = 'true';
  return vars;
}
