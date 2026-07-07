// feelslike.js — the heart of the app.
//
// Computes the Feels Like index: air temperature plus perceptual adjustments for
// humidity (via dew point), sun exposure, wind, and damp cold.
//
// All math in this file is °F / mph / W/m². Convert only at the display layer.
// Every constant lives in TUNING so the formula can be adjusted in one place.
// See CLAUDE.md ("The formula") for reasoning and worked test cases.

export const TUNING = {
  // Mugginess — dew point is what skin feels, not relative humidity.
  // The penalty ramps in tiers so oppressive dew points bite progressively harder.
  MUGGY_TIERS: [
    { above: 55, rate: 0.20 },
    { above: 65, rate: 0.25 },
    { above: 72, rate: 0.50 },
  ],
  MUGGY_TEMP_FLOOR: 62,   // below this air temp, mugginess stops mattering
  MUGGY_TEMP_SPAN: 18,    // reaches full effect at floor + span (80°F)
  MUGGY_SCALE_CAP: 1.1,   // slight overdrive in serious heat

  // Dry-air relief — evaporation actually works; shade beats the thermometer.
  DRY_DEW_POINT: 45,      // relief begins below this dew point
  DRY_RATE: 0.15,
  DRY_CAP: 4,
  DRY_TEMP_FLOOR: 80,     // only meaningful in real heat
  DRY_TEMP_SPAN: 10,

  // Sun — scaled from measured shortwave radiation (W/m²), so clouds and
  // low sun angles reduce it naturally. Full summer sun ≈ 950 W/m².
  SUN_FULL_RADIATION: 950,
  SUN_MAX: 12,

  // Wind, warm side — moving air helps most when the air is dry.
  WIND_WARM_EXP: 0.7,
  WIND_WARM_RATE: 0.35,
  WIND_WARM_CAP: 6,
  WIND_DRYNESS_FLOOR: 0.15, // muggy air still cools a little

  // Wind, cold side — NWS wind chill. Used below CHILL_TEMP, blended out
  // by WARM_WIND_TEMP so there is no seam between the two regimes.
  CHILL_TEMP: 60,
  WARM_WIND_TEMP: 65,
  CHILL_MIN_WIND: 3,

  // Damp cold — humid cold air conducts heat away faster.
  DAMP_RH_FLOOR: 70,
  DAMP_RATE: 0.15,
  DAMP_CAP: 5,
  DAMP_TEMP_CEIL: 55,
  DAMP_TEMP_SPAN: 10,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function mugginess(temp, dewPoint) {
  let base = 0;
  for (const tier of TUNING.MUGGY_TIERS) {
    base += Math.max(0, dewPoint - tier.above) * tier.rate;
  }
  const scale = clamp(
    (temp - TUNING.MUGGY_TEMP_FLOOR) / TUNING.MUGGY_TEMP_SPAN,
    0, TUNING.MUGGY_SCALE_CAP
  );
  return base * scale;
}

function dryRelief(temp, dewPoint) {
  if (dewPoint >= TUNING.DRY_DEW_POINT) return 0;
  const strength = clamp((temp - TUNING.DRY_TEMP_FLOOR) / TUNING.DRY_TEMP_SPAN, 0, 1);
  const relief = Math.min(TUNING.DRY_CAP, (TUNING.DRY_DEW_POINT - dewPoint) * TUNING.DRY_RATE);
  return -relief * strength;
}

function sunLoad(radiation) {
  if (!radiation || radiation <= 0) return 0;
  return Math.min(TUNING.SUN_MAX, (radiation / TUNING.SUN_FULL_RADIATION) * TUNING.SUN_MAX);
}

// NWS wind chill, expressed as a delta from air temperature (always <= 0).
function nwsChillDelta(temp, wind) {
  const v = Math.pow(wind, 0.16);
  const chill = 35.74 + 0.6215 * temp - 35.75 * v + 0.4275 * temp * v;
  return Math.min(0, chill - temp);
}

function warmWindDelta(wind, dewPoint) {
  const dryness = clamp((65 - dewPoint) / 30, TUNING.WIND_DRYNESS_FLOOR, 1);
  const cooling = Math.min(
    TUNING.WIND_WARM_CAP,
    Math.pow(wind, TUNING.WIND_WARM_EXP) * TUNING.WIND_WARM_RATE * dryness
  );
  return -cooling;
}

function windEffect(temp, wind, dewPoint) {
  if (!wind || wind < TUNING.CHILL_MIN_WIND) return 0;
  if (temp <= TUNING.CHILL_TEMP) return nwsChillDelta(temp, wind);
  if (temp >= TUNING.WARM_WIND_TEMP) return warmWindDelta(wind, dewPoint);
  const t = (temp - TUNING.CHILL_TEMP) / (TUNING.WARM_WIND_TEMP - TUNING.CHILL_TEMP);
  return nwsChillDelta(temp, wind) * (1 - t) + warmWindDelta(wind, dewPoint) * t;
}

function dampCold(temp, rh) {
  if (temp >= TUNING.DAMP_TEMP_CEIL || !rh || rh <= TUNING.DAMP_RH_FLOOR) return 0;
  const strength = clamp((TUNING.DAMP_TEMP_CEIL - temp) / TUNING.DAMP_TEMP_SPAN, 0, 1);
  const penalty = Math.min(TUNING.DAMP_CAP, (rh - TUNING.DAMP_RH_FLOOR) * TUNING.DAMP_RATE);
  return -penalty * strength;
}

/**
 * Compute the Feels Like index.
 * @param {object} obs — { temp, dewPoint, rh, wind, radiation } in °F / % / mph / W/m²
 * @returns {{ value: number, air: number, components: Array<{key, label, delta, detail}> }}
 *   value is unrounded; components only include adjustments with |delta| >= 0.5.
 */
export function computeFeelsLike(obs) {
  const { temp, dewPoint, rh, wind, radiation } = obs;
  const all = [
    { key: 'muggy', delta: mugginess(temp, dewPoint), label: 'mugginess', detail: `dew point ${Math.round(dewPoint)}°` },
    { key: 'dry', delta: dryRelief(temp, dewPoint), label: 'dry air', detail: `dew point ${Math.round(dewPoint)}°` },
    { key: 'sun', delta: sunLoad(radiation), label: 'sun', detail: '' },
    { key: 'wind', delta: windEffect(temp, wind, dewPoint), label: 'wind', detail: `${Math.round(wind)} mph` },
    { key: 'damp', delta: dampCold(temp, rh), label: 'damp cold', detail: `humidity ${Math.round(rh)}%` },
  ];

  // Friendlier labels that depend on magnitude
  const sun = all.find(c => c.key === 'sun');
  sun.label = sun.delta >= 9 ? 'full sun' : sun.delta >= 3 ? 'part sun' : 'thin sun';
  const w = all.find(c => c.key === 'wind');
  if (w.delta < 0 && temp <= TUNING.CHILL_TEMP) w.label = 'wind chill';
  else if (w.delta < 0) w.label = wind >= 13 ? 'wind' : 'breeze';

  const components = all.filter(c => Math.abs(c.delta) >= 0.5);
  const value = temp + all.reduce((sum, c) => sum + c.delta, 0);
  return { value, air: temp, components };
}

/**
 * Classify the mood used for the weather-reactive theme.
 * Thresholds documented in CLAUDE.md ("The mood system").
 */
export function classifyMood(feelsLike, dewPoint) {
  if (feelsLike >= 85) return dewPoint >= 62 ? 'humid-heat' : 'dry-heat';
  if (feelsLike >= 70) return 'warm';
  if (feelsLike >= 55) return 'mild';
  if (feelsLike >= 38) return 'chill';
  return 'cold';
}

export const MOODS = ['dry-heat', 'humid-heat', 'warm', 'mild', 'chill', 'cold'];
