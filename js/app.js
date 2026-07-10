// app.js — state and events. Rendering lives in ui.js, network in api.js.

import { searchPlaces, reverseName, fetchWeather } from './api.js';
import * as store from './storage.js';
import { renderAll, renderSuggestions } from './ui.js';
import { openExplainer, initExplainer } from './explain.js';
import { openFeedback, initFeedback } from './feedback.js';
import { SCENARIOS } from './mock.js';

const state = {
  unit: store.getUnit(),          // 'F' | 'C'
  panels: [],                     // [{ loc, data?, status, message? }] — max 2
  favorites: store.getFavorites(),
  suggestions: [],
  selIdx: -1,
  searchTarget: 0,                // which panel slot the next search fills
  locating: false,
};

const input = document.getElementById('searchInput');
const render = () => renderAll(state);

/* ---------- loading panels ---------- */

async function loadPanel(slot, loc, opts = {}) {
  const prev = state.panels[slot];
  const hasData = prev && prev.status === 'ready';
  if (opts.manual && hasData) {
    state.panels[slot] = { ...prev, refreshing: true }; // keep data, show spinner
    render();
  } else if (!opts.silent || !hasData) {
    // Silent refreshes keep the old data on screen instead of flashing a loader
    state.panels[slot] = { loc, status: 'loading' };
    render();
  }
  try {
    const data = await fetchWeather(loc);
    state.panels[slot] = { loc, data, status: 'ready', fetchedAt: Date.now() };
  } catch (err) {
    if ((opts.silent || opts.manual) && hasData) {
      state.panels[slot] = { ...prev, refreshing: false }; // keep last good data
    } else {
      state.panels[slot] = { loc, status: 'error', message: err.message };
    }
  }
  store.setActive(state.panels.filter(Boolean).map((p) => p.loc));
  render();
}

/* ---------- freshness ---------- */

const REFRESH_EVERY_MS = 15 * 60 * 1000;  // periodic re-fetch while open
const RESUME_STALE_MS = 5 * 60 * 1000;    // re-fetch on resume if older than this

function refreshPanels() {
  state.panels.forEach((p, i) => {
    if (p && p.loc && p.status !== 'loading') loadPanel(i, p.loc, { silent: true });
  });
}

// A PWA resumed from the background can be hours stale — refresh on resume.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const ages = state.panels.filter(Boolean).map((p) => p.fetchedAt || 0);
  if (ages.length && Date.now() - Math.min(...ages) > RESUME_STALE_MS) refreshPanels();
});

setInterval(() => { if (!document.hidden) refreshPanels(); }, REFRESH_EVERY_MS);
// Keep the "updated N min ago" labels honest between refreshes
setInterval(() => {
  if (!document.hidden && state.panels.some((p) => p && p.status === 'ready')) render();
}, 60 * 1000);

function removePanel(slot) {
  state.panels.splice(slot, 1);
  state.searchTarget = 0;
  store.setActive(state.panels.filter(Boolean).map((p) => p.loc));
  render();
}

/* ---------- search ---------- */

let debounceTimer;

function resetSearch() {
  input.value = '';
  input.placeholder = 'city or ZIP code';
  state.suggestions = [];
  state.selIdx = -1;
  renderSuggestions(state);
}

function pick(place) {
  const slot = state.searchTarget;
  state.searchTarget = 0;
  resetSearch();
  loadPanel(slot, place);
}

// People usually search for places near the one they're already looking at:
// float the closest few results to the top, tagged "nearby" in the dropdown.
// The rest keep the geocoder's relevance/population order.
function promoteNearby(results) {
  const ref = state.panels[0]?.loc;
  if (!ref || ref.lat == null || ref.mock || results.length <= 3) return;
  const distSq = (p) => {
    const dx = (p.lon - ref.lon) * Math.cos((((+p.lat) + (+ref.lat)) / 2) * Math.PI / 180);
    const dy = p.lat - ref.lat;
    return dx * dx + dy * dy;
  };
  const near = [...results].sort((a, b) => distSq(a) - distSq(b)).slice(0, 3)
    .filter((p) => distSq(p) < 25); // ~within 350 miles
  if (!near.length) return;
  near.forEach((p) => { p.near = true; });
  const rest = results.filter((p) => !near.includes(p));
  results.length = 0;
  results.push(...near, ...rest);
}

async function runSearch() {
  const q = input.value.trim();
  if (q.length < 2) {
    state.suggestions = [];
    renderSuggestions(state);
    return;
  }
  try {
    state.suggestions = await searchPlaces(q);
  } catch {
    state.suggestions = [];
  }
  promoteNearby(state.suggestions);
  state.suggestions = state.suggestions.slice(0, 14);
  state.selIdx = state.suggestions.length ? 0 : -1;
  renderSuggestions(state);
}

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, 280);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!state.suggestions.length) return;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    state.selIdx = (state.selIdx + dir + state.suggestions.length) % state.suggestions.length;
    renderSuggestions(state);
  } else if (e.key === 'Escape') {
    state.suggestions = [];
    renderSuggestions(state);
  }
});

// Pressing Enter, tapping the mobile keyboard's search key, or clicking the
// magnifier all land here: take the highlighted suggestion, or run the
// search and take its top result.
document.getElementById('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(debounceTimer);
  if (state.selIdx >= 0 && state.suggestions[state.selIdx]) {
    pick(state.suggestions[state.selIdx]);
  } else {
    await runSearch();
    if (state.suggestions[0]) pick(state.suggestions[0]);
  }
});

/* ---------- favorites ---------- */

function toggleFavorite(loc) {
  const key = store.locKey(loc);
  const i = state.favorites.findIndex((f) => store.locKey(f) === key);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push({ name: loc.name, region: loc.region || '', lat: loc.lat, lon: loc.lon });
  store.setFavorites(state.favorites);
  render();
}

/* ---------- geolocation ---------- */

function geolocate() {
  const btn = document.querySelector('.locate-btn');
  if (!navigator.geolocation) {
    hintPlaceholder('location not supported on this device');
    render();
    return;
  }
  state.locating = true;
  if (btn) btn.classList.add('locating');
  render();
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.locating = false;
    if (btn) btn.classList.remove('locating');
    const { latitude: lat, longitude: lon } = pos.coords;
    const named = await reverseName(lat, lon);
    loadPanel(0, { name: named.name, region: named.region, lat, lon });
  }, () => {
    // Denied or unavailable — an explicit button press deserves a visible answer
    state.locating = false;
    if (btn) btn.classList.remove('locating');
    hintPlaceholder('location unavailable — check permissions');
    render();
  }, { timeout: 8000, maximumAge: 600000 });
}

let hintTimer;
function hintPlaceholder(msg) {
  clearTimeout(hintTimer);
  input.placeholder = msg;
  hintTimer = setTimeout(() => { input.placeholder = 'city or ZIP code'; }, 3500);
}

/* ---------- global events ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    if (!e.target.closest('.search')) {
      state.suggestions = [];
      renderSuggestions(state);
    }
    return;
  }
  const slot = +el.dataset.slot;
  switch (el.dataset.action) {
    case 'pick': pick(state.suggestions[+el.dataset.idx]); break;
    case 'chip': {
      // While a compare is pending, a favorite chip fills the second slot
      const target = state.searchTarget === 1 ? 1 : 0;
      state.searchTarget = 0;
      resetSearch();
      loadPanel(target, state.favorites[+el.dataset.idx]);
      break;
    }
    case 'fav': toggleFavorite(state.panels[slot].loc); break;
    case 'remove': removePanel(slot); break;
    case 'compare': toggleCompareSearch(); break;
    case 'refresh': {
      const p = state.panels[slot];
      if (p && p.loc) loadPanel(slot, p.loc, { manual: true });
      break;
    }
    case 'explain': openExplainer(el.dataset.modal); break;
    case 'feedback': openFeedback(state.panels[slot], state.unit); break;
    case 'backup': copyBackupLink(el); break;
    case 'geolocate': geolocate(); break;
  }
});

function copyBackupLink(btn) {
  const payload = encodeURIComponent(btoa(JSON.stringify({ f: state.favorites, u: state.unit })));
  const url = `${location.origin}${location.pathname}?restore=${payload}`;
  const done = () => { btn.textContent = 'link copied — save it somewhere'; setTimeout(render, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => window.prompt('copy this link:', url));
  } else {
    window.prompt('copy this link:', url);
  }
}

function toggleCompareSearch() {
  if (state.searchTarget === 1) {
    state.searchTarget = 0;   // cancel pending compare search
    resetSearch();
  } else {
    state.searchTarget = 1;
    input.placeholder = state.favorites.length
      ? 'compare with… (or tap a favorite)'
      : 'compare with…';
    input.focus();
  }
  render();
}

document.getElementById('unitToggle').addEventListener('click', () => {
  state.unit = state.unit === 'F' ? 'C' : 'F';
  store.setUnit(state.unit);
  render();
});

/* ---------- boot ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* http (non-localhost) or unsupported — the app works fine without it */
  });
}

function init() {
  initExplainer();
  initFeedback();
  const params = new URLSearchParams(location.search);
  state.debug = params.has('debug');

  // ?restore=<payload> — favorites backup link (see copyBackupLink)
  const restore = params.get('restore');
  if (restore) {
    try {
      const saved = JSON.parse(atob(restore));
      const have = new Set(state.favorites.map(store.locKey));
      for (const f of saved.f || []) {
        if (f && f.lat != null && !have.has(store.locKey(f))) state.favorites.push(f);
      }
      store.setFavorites(state.favorites);
      if (saved.u === 'C' || saved.u === 'F') {
        state.unit = saved.u;
        store.setUnit(saved.u);
      }
    } catch { /* malformed link — ignore */ }
    history.replaceState(null, '', location.pathname);
  }

  const mock = params.get('mock');
  if (mock) {
    mock.split(',').slice(0, 2).forEach((m, i) => {
      const s = SCENARIOS[m.trim()];
      if (!s) return;
      const [name, region] = s.place.split(', ');
      loadPanel(i, {
        name, region: region || '', lat: 0, lon: 0, mock: m.trim(),
        night: params.has('night'),
        hour: params.get('hour') != null ? +params.get('hour') : undefined,
      });
    });
    return;
  }
  const active = store.getActive();
  if (active.length) {
    active.slice(0, 2).forEach((loc, i) => loadPanel(i, loc));
  } else {
    render();
    geolocate();
  }
}

init();
