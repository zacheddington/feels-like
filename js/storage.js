// storage.js — all localStorage access. Every key is namespaced "feelslike:".

const KEYS = {
  unit: 'feelslike:unit',
  favorites: 'feelslike:favorites',
  active: 'feelslike:active',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, etc.) — app still works, just forgets */
  }
}

export const getUnit = () => read(KEYS.unit, 'F');
export const setUnit = (u) => write(KEYS.unit, u);

export const getFavorites = () => read(KEYS.favorites, []);
export const setFavorites = (list) => write(KEYS.favorites, list);

// The locations currently on screen (1 or 2), restored on next visit.
// Mock locations are never saved.
export const getActive = () => read(KEYS.active, []);
export const setActive = (locs) => write(KEYS.active, locs.filter(l => l && !l.mock));

// Identity key for a location, used to match favorites.
export const locKey = (loc) => `${(+loc.lat).toFixed(2)},${(+loc.lon).toFixed(2)}`;
