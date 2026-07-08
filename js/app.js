// app.js — state and events. Rendering lives in ui.js, network in api.js.

import { searchPlaces, reverseName, fetchWeather } from './api.js';
import * as store from './storage.js';
import { renderAll, renderSuggestions } from './ui.js';
import { openExplainer, initExplainer } from './explain.js';
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

async function loadPanel(slot, loc) {
  state.panels[slot] = { loc, status: 'loading' };
  render();
  try {
    const data = await fetchWeather(loc);
    state.panels[slot] = { loc, data, status: 'ready' };
  } catch (err) {
    state.panels[slot] = { loc, status: 'error', message: err.message };
  }
  store.setActive(state.panels.filter(Boolean).map((p) => p.loc));
  render();
}

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
  if (!navigator.geolocation) { render(); return; }
  state.locating = true;
  render();
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.locating = false;
    const { latitude: lat, longitude: lon } = pos.coords;
    const named = await reverseName(lat, lon);
    loadPanel(0, { name: named.name, region: named.region, lat, lon });
  }, () => {
    state.locating = false;
    render();
  }, { timeout: 8000, maximumAge: 600000 });
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
    case 'chip': state.searchTarget = 0; loadPanel(0, state.favorites[+el.dataset.idx]); break;
    case 'fav': toggleFavorite(state.panels[slot].loc); break;
    case 'remove': removePanel(slot); break;
    case 'compare': toggleCompareSearch(); break;
    case 'explain': openExplainer(el.dataset.modal); break;
    case 'geolocate': geolocate(); break;
  }
});

function toggleCompareSearch() {
  if (state.searchTarget === 1) {
    state.searchTarget = 0;   // cancel pending compare search
    resetSearch();
  } else {
    state.searchTarget = 1;
    input.placeholder = 'compare with…';
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
  const params = new URLSearchParams(location.search);
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
