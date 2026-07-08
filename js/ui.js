// ui.js — everything that turns state into DOM. No fetching, no storage here.
// app.js owns state and events; this file only renders.

import { computeFeelsLike } from './feelslike.js';
import { applyTheme } from './theme.js';
import { locKey } from './storage.js';

/* ---------- formatting ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fToC = (f) => (f - 32) * 5 / 9;

// Whole-number temperature with a typographic minus.
function t(f, unit) {
  const v = Math.round(unit === 'C' ? fToC(f) : f);
  return String(v).replace('-', '−');
}

// Signed adjustment. °C deltas show halves so small ones don't vanish.
function delta(f, unit) {
  const v = unit === 'C' ? f * 5 / 9 : f;
  const sign = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  const num = unit === 'C'
    ? (Math.round(a * 2) / 2).toFixed(1).replace(/\.0$/, '')
    : String(Math.round(a));
  return `${sign}${num}°`;
}

const windFmt = (mph, unit) =>
  unit === 'C' ? `${Math.round(mph * 1.609)} km/h` : `${Math.round(mph)} mph`;

function hourLabel(h) {
  if (h === 0) return '12am';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/* ---------- weather codes (WMO) ---------- */

function condLabel(code) {
  const map = {
    0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'freezing fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain',
    66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'showers', 81: 'showers', 82: 'heavy showers',
    85: 'snow showers', 86: 'snow showers',
    95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
  };
  return map[code] || 'clouds';
}

const CLOUD = 'M7 18h9.5a3.8 3.8 0 0 0 .7-7.55A5.4 5.4 0 0 0 6.6 9.7 4.2 4.2 0 0 0 7 18z';
const CLOUD_HI = 'M7 15h9.5a3.8 3.8 0 0 0 .7-7.55A5.4 5.4 0 0 0 6.6 6.7 4.2 4.2 0 0 0 7 15z';

const GLYPHS = {
  sun: '<circle cx="12" cy="12" r="4.4"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/>',
  moon: `<path d="M14.5 3.6a8.7 8.7 0 1 0 6 12.6 7.1 7.1 0 0 1-6-12.6z"/>`,
  partly: `<circle cx="7.5" cy="7.5" r="2.8"/><path d="M7.5 2.6v1.4M2.6 7.5h1.4M4 4l1 1M11 4l-1 1"/><path d="M10.5 19.5h6.5a3.2 3.2 0 0 0 .6-6.35A4.6 4.6 0 0 0 9.5 12a3.7 3.7 0 0 0 1 7.5z"/>`,
  cloud: `<path d="${CLOUD}"/>`,
  fog: '<path d="M4 9.5h16M6 13.5h13M4 17.5h15"/>',
  drizzle: `<path d="${CLOUD_HI}"/><path d="M8.5 18.5h.01M12.5 19.8h.01M16.5 18.5h.01" stroke-width="2.6"/>`,
  rain: `<path d="${CLOUD_HI}"/><path d="M8.8 18l-1.1 2.6M12.8 18l-1.1 2.6M16.8 18l-1.1 2.6"/>`,
  snow: '<path d="M12 4.5v15M5.5 8.2l13 7.6M18.5 8.2l-13 7.6"/>',
  thunder: `<path d="${CLOUD_HI}"/><path d="M13 15.5l-2.6 4h3.2l-2.2 3.8"/>`,
};

function glyphKey(code, isDay) {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}

export function glyph(code, isDay = 1, cls = 'glyph') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${GLYPHS[glyphKey(code, isDay)]}</svg>`;
}

/* ---------- feels-like series (computed once per payload) ---------- */

function obsAt(h, i) {
  return {
    temp: h.temperature_2m[i],
    dewPoint: h.dew_point_2m[i],
    rh: h.relative_humidity_2m[i],
    wind: h.wind_speed_10m[i],
    radiation: h.shortwave_radiation[i],
  };
}

function flSeries(data) {
  if (!data._fl) {
    data._fl = data.hourly.time.map((_, i) => computeFeelsLike(obsAt(data.hourly, i)).value);
  }
  return data._fl;
}

function currentFeel(data) {
  const c = data.current;
  return computeFeelsLike({
    temp: c.temperature_2m,
    dewPoint: c.dew_point_2m,
    rh: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    radiation: c.shortwave_radiation,
  });
}

/* ---------- panel pieces ---------- */

function ageLine(entry) {
  if (!entry.fetchedAt) return '';
  const mins = Math.round((Date.now() - entry.fetchedAt) / 60000);
  const when = mins < 2 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} hr ago`;
  return entry.data && entry.data._fromCache
    ? `<span class="age stale">offline — showing data from ${when}</span>`
    : `<span class="age">updated ${when}</span>`;
}

function heroHTML(entry, unit) {
  const data = entry.data;
  const c = data.current;
  const feel = currentFeel(data);
  return `
  <div class="hero">
    <div class="hero-num-wrap">
      <span class="hero-label">feels like</span>
      <div class="hero-num">${t(feel.value, unit)}<span class="hero-deg">°</span></div>
    </div>
    <div class="hero-side">
      <span class="cond">${glyph(c.weather_code, c.is_day)}<span>${condLabel(c.weather_code)}</span></span>
      <span class="air-line">thermometer says <strong>${t(c.temperature_2m, unit)}°</strong></span>
      <span class="meta">dew point ${t(c.dew_point_2m, unit)}° · humidity ${Math.round(c.relative_humidity_2m)}% · wind ${windFmt(c.wind_speed_10m, unit)}</span>
      ${ageLine(entry)}
    </div>
  </div>`;
}

function ledgerHTML(data, unit) {
  const c = data.current;
  const feel = currentFeel(data);
  const details = {
    muggy: `dew point ${t(c.dew_point_2m, unit)}°`,
    dry: `dew point ${t(c.dew_point_2m, unit)}°`,
    sun: '',
    wind: windFmt(c.wind_speed_10m, unit),
    damp: `humidity ${Math.round(c.relative_humidity_2m)}%`,
  };
  const rows = feel.components.map((comp) => `
    <div class="row">
      <dt><button class="term term-sm" data-action="explain" data-modal="${comp.key}"
        title="see this calculation">${comp.label}</button>${details[comp.key] ? `<span class="det">${details[comp.key]}</span>` : ''}</dt>
      <dd class="${comp.delta >= 0 ? 'up' : 'down'}">${delta(comp.delta, unit)}</dd>
    </div>`).join('');
  return `
  <dl class="ledger">
    <div class="row base"><dt>air temperature</dt><dd>${t(feel.air, unit)}°</dd></div>
    ${rows || '<div class="row"><dt class="det">nothing to adjust — the thermometer is honest today</dt><dd></dd></div>'}
    <div class="row total"><dt>feels like</dt><dd>${t(feel.value, unit)}°</dd></div>
  </dl>`;
}

function chartSVG(data, unit) {
  const h = data.hourly;
  const start = data.nowIndex;
  const end = Math.min(start + 24, h.time.length - 1);
  const fl = flSeries(data).slice(start, end + 1);
  const air = h.temperature_2m.slice(start, end + 1);
  const n = fl.length;
  if (n < 2) return '';

  const W = 640, H = 190, padL = 12, padR = 12, padT = 30, padB = 26;
  const yMin = Math.min(...fl, ...air) - 3;
  const yMax = Math.max(...fl, ...air) + 3;
  const x = (i) => padL + (i * (W - padL - padR)) / (n - 1);
  const y = (v) => padT + ((yMax - v) * (H - padT - padB)) / (yMax - yMin);
  const pts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // Shade night hours
  let bands = '';
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const night = i < n && !h.is_day[start + i];
    if (night && runStart < 0) runStart = i;
    if (!night && runStart >= 0) {
      bands += `<rect x="${x(runStart).toFixed(1)}" y="${padT - 8}" width="${(x(i - 1) - x(runStart)).toFixed(1)}" height="${H - padT - padB + 8}" class="ch-night"/>`;
      runStart = -1;
    }
  }

  // Hour ticks every 6 hours
  let ticks = '';
  for (let i = 0; i < n; i++) {
    const hr = parseInt(h.time[start + i].slice(11, 13), 10);
    if (i > 0 && hr % 6 === 0) {
      const tx = Math.min(Math.max(x(i), 18), W - 20);
      ticks += `<text x="${tx.toFixed(1)}" y="${H - 8}" class="ch-tick">${hourLabel(hr)}</text>`;
    }
  }

  // Peak and trough labels on the feels-like line
  const iMax = fl.indexOf(Math.max(...fl));
  const iMin = fl.indexOf(Math.min(...fl));
  const label = (i, v, above) => {
    const lx = Math.min(Math.max(x(i), 18), W - 18);
    const ly = above ? y(v) - 9 : y(v) + 16;
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="ch-peak">${t(v, unit)}°</text>`;
  };

  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
       aria-label="Feels-like temperature for the next 24 hours">
    ${bands}
    <polygon class="ch-area" points="${pts(fl)} ${x(n - 1).toFixed(1)},${H - padB} ${padL},${H - padB}"/>
    <polyline class="ch-air" points="${pts(air)}"/>
    <polyline class="ch-fl" points="${pts(fl)}"/>
    <circle class="ch-now" cx="${x(0)}" cy="${y(fl[0]).toFixed(1)}" r="4"/>
    <text x="${Math.max(x(0), 20)}" y="${H - 8}" class="ch-tick ch-tick-now">now</text>
    ${label(iMax, fl[iMax], true)}${iMin !== iMax ? label(iMin, fl[iMin], false) : ''}
    ${ticks}
  </svg>
  <div class="legend">
    <span class="lg lg-fl">feels like</span>
    <span class="lg lg-air">air temperature</span>
  </div>`;
}

function weekHTML(data, unit) {
  const d = data.daily;
  const h = data.hourly;
  const fl = flSeries(data);
  const cells = d.time.map((date, di) => {
    const idxs = [];
    for (let i = 0; i < h.time.length; i++) if (h.time[i].startsWith(date)) idxs.push(i);
    if (!idxs.length) return '';
    const dayFl = idxs.map((i) => fl[i]);
    const dayAir = idxs.map((i) => h.temperature_2m[i]);
    const [yy, mm, dd] = date.split('-').map(Number);
    const name = di === 0 ? 'today'
      : new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
    return `
    <div class="day">
      <span class="d-name">${name}</span>
      ${glyph(d.weather_code[di], 1, 'glyph d-glyph')}
      <span class="d-hi">${t(Math.max(...dayFl), unit)}°</span>
      <span class="d-lo">${t(Math.min(...dayFl), unit)}°</span>
      <span class="d-air">air ${t(Math.max(...dayAir), unit)}°</span>
    </div>`;
  }).join('');
  return `<div class="week">${cells}</div>`;
}

const STAR = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z"/></svg>`;

function panelHTML(entry, state, slot) {
  const { loc, data, status, message } = entry;
  const isFav = state.favorites.some((f) => locKey(f) === locKey(loc));
  const panelCount = state.panels.filter(Boolean).length;
  const removeBtn = panelCount === 2
    ? `<button class="icon-btn" data-action="remove" data-slot="${slot}" aria-label="Remove ${esc(loc.name)}" title="remove">✕</button>`
    : '';
  const compareBtn = slot === 0 && panelCount === 1 && status === 'ready'
    ? `<button class="text-btn" data-action="compare">${state.searchTarget === 1 ? 'cancel' : '+ compare'}</button>`
    : '';
  let body = '';
  if (status === 'loading') {
    body = '<p class="panel-note">reading the air…</p>';
  } else if (status === 'error') {
    body = `<p class="panel-note err">${esc(message || 'the weather service is not answering')} — try again in a moment</p>`;
  } else if (data) {
    body = `
      ${heroHTML(entry, state.unit)}
      ${ledgerHTML(data, state.unit)}
      <button class="fb-trigger" data-action="feedback" data-slot="${slot}">disagree with this number?</button>
      <section class="block">
        <h3 class="block-title">the next 24 hours</h3>
        ${chartSVG(data, state.unit)}
      </section>
      <section class="block">
        <h3 class="block-title">the week ahead</h3>
        ${weekHTML(data, state.unit)}
      </section>`;
  }
  return `
  <article class="panel" data-slot="${slot}">
    <header class="panel-head">
      <h2 class="place">${esc(loc.name)}${loc.region ? `<span class="region">, ${esc(loc.region)}</span>` : ''}</h2>
      <div class="panel-actions">
        ${compareBtn}
        <button class="icon-btn fav${isFav ? ' active' : ''}" data-action="fav" data-slot="${slot}"
          aria-label="${isFav ? 'Remove from' : 'Add to'} favorites" aria-pressed="${isFav}"
          title="favorite">${STAR}</button>
        ${removeBtn}
      </div>
    </header>
    ${body}
  </article>`;
}

/* ---------- top-level renders ---------- */

export function renderSuggestions(state) {
  const ul = document.getElementById('suggestions');
  if (!state.suggestions.length) {
    ul.hidden = true;
    ul.innerHTML = '';
    return;
  }
  ul.hidden = false;
  ul.innerHTML = state.suggestions.map((p, i) => `
    <li class="${i === state.selIdx ? 'sel' : ''}" data-action="pick" data-idx="${i}" role="option">
      ${esc(p.name)}${p.region ? `, ${esc(p.region)}` : ''}
      <span class="sug-country">${esc(p.country)}</span>
    </li>`).join('');
}

function applyMood(state) {
  const primary = state.panels[0];
  if (!primary || !primary.data) {
    applyTheme(); // sky clock at the browser's local time, clear weather
    return;
  }
  const d = primary.data;
  const c = d.current;
  const feel = currentFeel(d);
  applyTheme({
    timeISO: c.time,
    sunriseISO: d.daily.sunrise ? d.daily.sunrise[0] : null,
    sunsetISO: d.daily.sunset ? d.daily.sunset[0] : null,
    weatherCode: c.weather_code,
    cloudCover: c.cloud_cover,
    isDay: c.is_day,
    feelsLike: feel.value,
    dewPoint: c.dew_point_2m,
  });
}

export function renderAll(state) {
  const panelsEl = document.getElementById('panels');
  const panels = state.panels.filter(Boolean);

  if (!panels.length) {
    panelsEl.innerHTML = `
    <div class="empty">
      <p class="empty-big">Where are you?</p>
      <p class="empty-hint">${state.locating
        ? 'asking your browser where you are — or just search above'
        : 'search a city or ZIP code above'}</p>
      <button class="ghost-btn" data-action="geolocate">use my location</button>
    </div>`;
  } else {
    panelsEl.innerHTML = panels.map((p, i) => panelHTML(p, state, i)).join('');
  }
  panelsEl.classList.toggle('compare', panels.length === 2);

  // Favorites bar (+ backup link — localStorage is evictable, esp. iOS PWAs)
  const favEl = document.getElementById('favorites');
  favEl.innerHTML = state.favorites.map((f, i) => `
    <button class="chip" data-action="chip" data-idx="${i}">
      ${esc(f.name)}${f.region ? `<span class="chip-region"> ${esc(f.region)}</span>` : ''}
    </button>`).join('')
    + (state.favorites.length ? `
    <button class="chip chip-backup" data-action="backup"
      title="copies a link that restores these favorites on any device">backup</button>` : '');
  favEl.hidden = !state.favorites.length;

  // Unit toggle
  document.querySelectorAll('#unitToggle [data-unit]').forEach((el) => {
    el.classList.toggle('active', el.dataset.unit === state.unit);
  });

  document.title = panels[0]
    ? `Feels Like — ${panels[0].loc.name}`
    : 'Feels Like — what the air actually feels like';

  applyMood(state);
}
