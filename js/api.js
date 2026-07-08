// api.js — all network access. Every endpoint here is keyless and CORS-open,
// which is what lets this app run on GitHub Pages with no backend and no secrets.

import { mockWeather } from './mock.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const ZIP = 'https://api.zippopotam.us/us/';
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

const HOURLY_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m',
  'cloud_cover', 'shortwave_radiation', 'precipitation_probability',
  'weather_code', 'is_day',
].join(',');

const CURRENT_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
  'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'is_day',
].join(',');

const DAILY_VARS = ['weather_code', 'sunrise', 'sunset'].join(',');

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina',
  nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
};

const STATE_NAMES = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) =>
  [abbr.toUpperCase(), name.replace(/\b\w/g, (c) => c.toUpperCase())]));

async function geocode(name, count = 6) {
  bumpUsage();
  const j = await getJSON(`${GEOCODE}?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json`);
  return (j.results || []).map(r => ({
    name: r.name,
    region: r.admin1 || '',
    country: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/**
 * Search for places by city name or 5-digit US ZIP.
 * Returns [{ name, region, country, lat, lon }].
 *
 * Open-Meteo's geocoder only matches bare place names — "Jackson Mississippi"
 * and "Jackson, MS" return nothing. So when the full query misses, we split
 * off a trailing state/country qualifier, search the bare name, and use the
 * qualifier to filter the results.
 */
export async function searchPlaces(query) {
  const q = query.trim();
  if (!q) return [];

  if (/^\d{5}$/.test(q)) {
    try {
      const j = await getJSON(ZIP + q);
      const p = j.places && j.places[0];
      if (!p) return [];
      return [{
        name: p['place name'],
        // Full state name, matching how the geocoder presents results
        region: STATE_NAMES[p['state abbreviation']] || p['state abbreviation'] || '',
        country: 'US',
        lat: +p.latitude,
        lon: +p.longitude,
      }];
    } catch {
      return []; // zippopotam 404s on unknown ZIPs
    }
  }

  // Fetch deep: the geocoder ranks by population, so small towns sit well
  // past the first page (Madison, MS is #12 among "Madison"s). app.js
  // promotes nearby hits from this pool, then caps what the dropdown shows.
  let results = await geocode(q, 25);
  if (results.length) return results;

  let name, qualifier;
  const comma = q.indexOf(',');
  if (comma > 0) {
    name = q.slice(0, comma).trim();
    qualifier = q.slice(comma + 1).trim();
  } else {
    const words = q.split(/\s+/);
    if (words.length < 2) return [];
    qualifier = words.pop();
    name = words.join(' ');
  }
  if (!name || !qualifier) return [];

  // Fetch a deep result set: the geocoder ranks by population, so a small
  // town like Madison, MS never appears in the top handful of "Madison"s.
  // The qualifier filter is what surfaces it.
  results = await geocode(name, 100);
  const target = (US_STATES[qualifier.toLowerCase()] || qualifier).toLowerCase();
  const matches = results.filter((r) =>
    r.region.toLowerCase().startsWith(target) ||
    r.country.toLowerCase() === qualifier.toLowerCase()
  );
  return (matches.length ? matches : results).slice(0, 12);
}

/* ---------- local API-call meter (shown in the footer with ?debug) ---------- */
// Counts only this device's Open-Meteo requests. There is no account or
// central quota: every visitor calls Open-Meteo from their own IP, and the
// fair-use limit applies per client, not to the app as a whole.

const USAGE_KEY = 'feelslike:apicalls';

function bumpUsage() {
  try {
    const all = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    const today = new Date().toISOString().slice(0, 10);
    all[today] = (all[today] || 0) + 1;
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    for (const day of Object.keys(all)) if (day < cutoff) delete all[day];
    localStorage.setItem(USAGE_KEY, JSON.stringify(all));
  } catch { /* meter is best-effort */ }
}

export function getUsage() {
  try {
    const all = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let week = 0;
    for (const [day, n] of Object.entries(all)) if (day >= weekAgo) week += n;
    return { today: all[today] || 0, week };
  } catch {
    return { today: 0, week: 0 };
  }
}

/** Best-effort place name for coordinates (used after browser geolocation). */
export async function reverseName(lat, lon) {
  try {
    const j = await getJSON(`${REVERSE}?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    return {
      name: j.city || j.locality || 'My location',
      region: j.principalSubdivisionCode ? j.principalSubdivisionCode.replace(/^US-/, '') : '',
    };
  } catch {
    return { name: 'My location', region: '' };
  }
}

/**
 * Fetch a full forecast for a location. Always in °F/mph internally —
 * the display layer converts. Returns the Open-Meteo payload, normalized:
 *  - data.nowIndex: index into hourly arrays closest to (not after) current time
 *  - current is backfilled from hourly for any variable the current block lacks
 *  - current.shortwave_radiation is always taken from hourly (not a current variable)
 */
export async function fetchWeather(loc) {
  if (loc.mock) return mockWeather(loc.mock, { night: !!loc.night, hour: loc.hour });

  const url = `${FORECAST}?latitude=${loc.lat}&longitude=${loc.lon}`
    + `&current=${CURRENT_VARS}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`
    + `&timezone=auto&forecast_days=7`;
  bumpUsage();
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  const data = normalize(await res.json());
  // Set by the service worker when this response came from cache (offline)
  data._fromCache = res.headers.get('X-Feels-Like-Cache') === 'fallback';
  return data;
}

function normalize(data) {
  const h = data.hourly;
  const c = data.current;
  let now = 0;
  for (let i = 0; i < h.time.length; i++) {
    if (h.time[i] <= c.time) now = i;
    else break;
  }
  data.nowIndex = now;
  c.shortwave_radiation = h.shortwave_radiation[now];
  if (c.dew_point_2m == null) c.dew_point_2m = h.dew_point_2m[now];
  if (c.relative_humidity_2m == null) c.relative_humidity_2m = h.relative_humidity_2m[now];
  if (c.wind_speed_10m == null) c.wind_speed_10m = h.wind_speed_10m[now];
  return data;
}
