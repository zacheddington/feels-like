// explain.js — the "show your work" modals.
//
// Every component of the Feels Like index can be opened from the explainer or
// the ledger to reveal: what the adjustment does, the live tuning constants,
// the ACTUAL functions running on this page, and the sources behind the
// approach. The code shown is produced by Function.prototype.toString() on
// the live module — it is not a copy, so it can never drift from what is
// deployed. Change feelslike.js, redeploy, and these modals update themselves.

import {
  TUNING, mugginess, dryRelief, sunLoad, nwsChillDelta, warmWindDelta,
  windEffect, dampCold, classifyMood,
} from './feelslike.js';
import { skyColors, weatherTint } from './theme.js';

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ENTRIES = {
  muggy: {
    title: 'mugginess',
    what: `Built on dew point — the temperature the air would have to cool to
      before its moisture condenses — because dew point, not relative humidity,
      is what skin feels. 100% relative humidity at 50° is a pleasant morning;
      a 75° dew point is oppressive anywhere on Earth. The penalty ramps in
      tiers (each tier's rate applies to every degree of dew point above its
      threshold), then scales with air temperature so humidity stops mattering
      in cool air. This is the reason equal thermometer readings in Mississippi
      and New Mexico get very different numbers here.`,
    fns: [mugginess],
    tuning: ['MUGGY_TIERS', 'MUGGY_TEMP_FLOOR', 'MUGGY_TEMP_SPAN', 'MUGGY_SCALE_CAP'],
    cites: [
      { label: 'NWS — Dew Point vs. Relative Humidity', url: 'https://www.weather.gov/arx/why_dewpoint_vs_humidity' },
      { label: 'Rothfusz (1990), the NWS heat index — the approach we deliberately diverge from', url: 'https://www.weather.gov/media/ffc/ta_htindx.pdf' },
    ],
  },
  dry: {
    title: 'dry air',
    what: `When dew point is very low, sweat evaporates as fast as you produce
      it and shade genuinely works — dry heat reads a few degrees below the
      thermometer. A small credit that only applies in real heat, capped so it
      never pretends a 100° afternoon is comfortable.`,
    fns: [dryRelief],
    tuning: ['DRY_DEW_POINT', 'DRY_RATE', 'DRY_CAP', 'DRY_TEMP_FLOOR', 'DRY_TEMP_SPAN'],
    cites: [
      { label: 'Steadman (1994) apparent temperature, via Australian BoM — the model family that lets feels-like fall below air temperature in dry air', url: 'http://www.bom.gov.au/info/thermal_stress/' },
    ],
  },
  sun: {
    title: 'sun',
    what: `Scaled linearly from measured shortwave solar radiation (W/m²) up to
      a cap, so cloud cover and low sun angles reduce it automatically and it
      is zero at night. For calibration: NWS notes that full sunshine can raise
      heat-index values by up to 15°F, and its wind-chill guidance says bright
      sunshine can warm the wind chill by 10–18°F. Our cap sits inside both
      bands. Almost no weather app accounts for this — it is much of why
      "feels like" numbers feel wrong the moment you step into the sun.`,
    fns: [sunLoad],
    tuning: ['SUN_FULL_RADIATION', 'SUN_MAX'],
    cites: [
      { label: 'NWS — What is the heat index? ("full sunshine can increase heat index values by up to 15°F")', url: 'https://www.weather.gov/ama/heatindex' },
      { label: 'NWS — Wind Chill Safety (bright sunshine +10 to +18°F)', url: 'https://www.weather.gov/safety/cold-wind-chill-chart' },
    ],
  },
  wind: {
    title: 'wind',
    what: `Two regimes, blended. At or below 50°F with wind above 3 mph — the
      exact domain the National Weather Service defines — we apply the 2001
      NWS/JAG/TI wind-chill formula: WC = 35.74 + 0.6215T − 35.75V^0.16 +
      0.4275TV^0.16 (T in °F, V in mph). In warm air (65°F and up) that formula
      no longer applies, so moving air is modeled as evaporative cooling: the
      benefit grows with wind speed but shrinks as dew point rises, because a
      hot muggy wind barely helps. Between 50°F and 65°F the two models are
      blended linearly so the number never jumps at a boundary.`,
    fns: [windEffect, nwsChillDelta, warmWindDelta],
    tuning: ['CHILL_TEMP', 'WARM_WIND_TEMP', 'CHILL_MIN_WIND', 'WIND_WARM_EXP', 'WIND_WARM_RATE', 'WIND_WARM_CAP', 'WIND_DRYNESS_FLOOR'],
    cites: [
      { label: 'NWS wind chill formula (official calculation sheet)', url: 'https://www.weather.gov/media/epz/wxcalc/windChill.pdf' },
      { label: 'NWS — Wind Chill Chart & the 2001 index', url: 'https://www.weather.gov/safety/cold-wind-chill-chart' },
      { label: 'Australian BoM apparent temperature — wind term in warm conditions', url: 'http://www.bom.gov.au/info/thermal_stress/' },
    ],
  },
  damp: {
    title: 'damp cold',
    what: `Humid cold air pulls heat from your body faster than dry cold —
      moisture makes clothing and air more conductive, which is why raw,
      drizzly 40° days feel meaner than the thermometer admits. No standard
      index covers this well, so this one is our own heuristic: small, capped,
      driven by relative humidity, and fading in only below the ceiling
      temperature. If you think it's over- or under-tuned, the constants are
      right below.`,
    fns: [dampCold],
    tuning: ['DAMP_RH_FLOOR', 'DAMP_RATE', 'DAMP_CAP', 'DAMP_TEMP_CEIL', 'DAMP_TEMP_SPAN'],
    cites: [
      { label: 'ISO 11079 — cold stress and required clothing insulation (background on wet-cold heat loss)', url: 'https://www.iso.org/standard/38900.html' },
    ],
  },
  colors: {
    title: 'the colors',
    what: `The background is a sky clock: it follows the sun at the searched
      location through night, first light, sunrise, midday, golden hour,
      sunset, dusk, and back — interpolated minute-by-minute between keyframe
      colors anchored to the location's actual sunrise and sunset. Weather
      lays a tint over the sky (gray overcast, blue-gray rain, pale fog)
      without replacing it. The accent color comes from the temperature mood
      below — heat stays warm-toned, cold stays cool-toned.`,
    fns: [classifyMood, skyColors, weatherTint],
    tuning: [],
    cites: [],
  },
};

function tuningBlock(keys) {
  if (!keys.length) return '';
  const subset = {};
  for (const k of keys) subset[k] = TUNING[k];
  return `<h4>live constants (TUNING)</h4>
    <pre class="modal-code">${esc(JSON.stringify(subset, null, 2))}</pre>`;
}

export function openExplainer(key) {
  const entry = ENTRIES[key];
  const dlg = document.getElementById('calcModal');
  if (!entry || !dlg) return;

  document.getElementById('calcModalTitle').textContent = entry.title;
  document.getElementById('calcModalBody').innerHTML = `
    <p class="modal-what">${entry.what}</p>
    ${tuningBlock(entry.tuning)}
    <h4>the code running right now</h4>
    <p class="modal-note">Read live from this page's own functions — not a copy.
      If the deployed code changes, so does this.</p>
    <pre class="modal-code">${esc(entry.fns.map((f) => f.toString()).join('\n\n'))}</pre>
    ${entry.cites.length ? `<h4>sources</h4>
      <ul class="modal-cites">${entry.cites.map((c) =>
        `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a></li>`).join('')}</ul>` : ''}
  `;
  dlg.showModal();
}

export function initExplainer() {
  const dlg = document.getElementById('calcModal');
  if (!dlg) return;
  dlg.addEventListener('click', (e) => {
    // Backdrop click closes (a click on the dialog element itself, not children)
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}
