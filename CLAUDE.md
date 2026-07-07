# Feels Like — instructions for working on this codebase

A static weather app about one idea: the temperature your skin feels, not the one
the thermometer reports. Custom "feels like" index built from dew point, sun,
wind, and damp cold, with a visible breakdown ledger. Hosted on GitHub Pages.

## Hard rules — do not break these

1. **No frameworks, no build step, no npm dependencies.** Vanilla HTML/CSS/JS with
   ES modules. The repo is deployed as-is; `git push` is the whole pipeline.
2. **All asset/module paths are relative** (`./css/...`, `./js/...`). GitHub Pages
   serves from a subpath (`/feels-like/`); absolute paths break it.
3. **All internal math is °F / mph / W/m².** Convert to °C/km-h only in the
   display helpers in `js/ui.js` (`t()`, `delta()`, `windFmt()`).
4. **Never use a raw color in CSS.** Everything reads the mood variables
   (`--bg --ink --muted --line --accent --haze`). See "Mood system" below.
5. **Keyless APIs only.** There is no backend and no place to hide a secret.
6. **Escape user/API strings** interpolated into HTML (use `esc()` in ui.js).

## File map

| File | Responsibility |
|---|---|
| `index.html` | Static shell: masthead, search, favorites nav, `#panels`, explainer footer |
| `css/style.css` | All styles. Mood palettes at top, then components |
| `js/app.js` | State + all event handling. Owns `state`, calls renderers |
| `js/ui.js` | All rendering (panels, ledger, SVG chart, week strip, glyphs, mood application). No fetching, no storage |
| `js/feelslike.js` | The formula (`computeFeelsLike`) + mood classification (`classifyMood`). All constants in `TUNING` |
| `js/api.js` | All network: Open-Meteo forecast + geocoding, Zippopotam (ZIPs), BigDataCloud (reverse geocode) |
| `js/mock.js` | Synthetic weather scenarios for offline testing / palette previews |
| `js/storage.js` | localStorage wrapper (`feelslike:unit`, `feelslike:favorites`, `feelslike:active`) |

Data flow: search → `api.searchPlaces` → user picks → `api.fetchWeather` →
`app.loadPanel` stores `{loc, data, status}` in `state.panels[slot]` →
`ui.renderAll(state)` re-renders everything and sets `body[data-mood]`.

## APIs (all free, keyless, CORS-open)

- **Forecast**: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..`
  with `current`, `hourly` (7 days), `daily` variable lists — see `js/api.js`.
  Always request `temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`.
  Quirks handled in `normalize()`: `shortwave_radiation` is not a `current`
  variable so it's copied from the nearest hourly index; `data.nowIndex` is the
  hourly index at/just before `current.time` (string compare — both are in the
  location's local timezone, never `new Date()` them for indexing).
- **Geocoding**: `https://geocoding-api.open-meteo.com/v1/search?name=..` —
  matches bare place names ONLY. "Jackson MS" returns nothing, so
  `searchPlaces()` retries with the last word / after-comma text split off as a
  state-or-country qualifier and filters results (US state abbreviations are
  expanded via the `US_STATES` map). Don't remove that fallback.
- **US ZIPs**: `https://api.zippopotam.us/us/<zip>` for 5-digit queries (404 = unknown ZIP).
- **Reverse geocode** (after browser geolocation): `https://api.bigdatacloud.net/data/reverse-geocode-client`.

## The formula (js/feelslike.js)

`feels like = air temp + mugginess + dry-air relief + sun + wind + damp cold`.
Every constant is in the exported `TUNING` object — tune there, nowhere else.

- **Mugginess** uses **dew point, not relative humidity** (RH is misleading; dew
  point maps to perception: ≥65 muggy, ≥72 oppressive). Tiered rates above
  55/65/72°F dew point, scaled by air temp (no effect ≤62°F, full at 80°F).
  This is the app's thesis: same heat index feels worse in Mississippi than
  New Mexico, and the dew-point tiers capture that.
- **Dry-air relief**: dew point <45 and temp ≥80 → small credit (max −4).
- **Sun**: `min(12, radiation/950 × 12)` from measured shortwave radiation, so
  clouds/low sun reduce it automatically; 0 at night.
- **Wind**: NWS wind chill below 60°F; evaporative-cooling model at ≥65°F
  (helps more when dry); linear blend between 60–65 so there is no seam.
- **Damp cold**: RH >70% below 55°F → penalty (max −5).

`computeFeelsLike(obs)` returns `{ value, air, components }`; components with
|delta| < 0.5°F are dropped from the ledger.

### Regression checks (run in the browser console at the site root)

```js
const m = await import('./js/feelslike.js');
m.computeFeelsLike({temp:91, dewPoint:74, rh:57, wind:5,  radiation:900}).value // ≈ 109.96 (humid MS afternoon)
m.computeFeelsLike({temp:91, dewPoint:30, rh:11, wind:8,  radiation:900}).value // ≈ 98.62  (dry NM afternoon)
m.computeFeelsLike({temp:35, dewPoint:32, rh:90, wind:15, radiation:0}).value   // ≈ 22.43  (raw damp winter day)
```

If you change `TUNING`, recompute and update these three numbers in the same commit.

## Mood system (weather-reactive theme)

`ui.applyMood()` sets `body[data-mood]` from the **primary panel's current**
feels-like + dew point, and `body[data-night]` from `current.is_day`.

| feels like | dew point | mood |
|---|---|---|
| ≥ 85 | ≥ 62 | `humid-heat` |
| ≥ 85 | < 62 | `dry-heat` |
| 70–85 | — | `warm` |
| 55–70 | — | `mild` |
| 38–55 | — | `chill` |
| < 38 | — | `cold` |

Each mood (and its `[data-night]` variant) defines the full palette contract at
the top of `style.css`: `--bg --ink --muted --line --accent --haze`. To add or
adjust a mood: define all six variables for day AND night, add the threshold in
`classifyMood()`, add a scenario in `mock.js`, and eyeball it with `?mock=<name>`.

## Mock mode — test without the network

- `./?mock=humid-heat` — one scenario (names = `SCENARIOS` keys in `js/mock.js`,
  which match the mood names)
- `./?mock=dry-heat,humid-heat` — compare mode
- `./?mock=warm&night` — night palette
- Mock "now" is pinned to 3pm (10pm with `&night`) so scenarios look identical
  whenever you run them. Mock locations are never written to localStorage.

## State shape (js/app.js)

```js
state = {
  unit: 'F' | 'C',
  panels: [{ loc: {name, region, lat, lon}, data, status: 'loading'|'ready'|'error' }], // max 2
  favorites: [{name, region, lat, lon}],
  suggestions: [], selIdx: -1,
  searchTarget: 0 | 1,   // which slot the next search fills (1 while picking a compare city)
  locating: false,
}
```

Buttons use `data-action` attributes handled by one delegated click listener in
app.js (`pick`, `chip`, `fav`, `remove`, `geolocate`). Renders are full
`innerHTML` swaps of `#panels` / `#favorites` — cheap at this size; keep it that way.

## Design guardrails

- Fonts: **Fraunces** (display serif — big numbers, place names, search input)
  and **IBM Plex Mono** (labels, data, everything small). No other fonts.
- The aesthetic is editorial/analog: hairline rules, uppercase mono labels with
  letter-spacing, a film-grain overlay (`body::after`), one accent color per mood.
- **Never add**: purple/blue gradients, glassmorphism cards, emoji icons, drop
  shadows on cards, rounded-corner card grids. Weather icons are the hand-drawn
  stroke SVG glyphs in `ui.js` (`GLYPHS`) — extend those, don't import an icon set.
- Charts are hand-rolled SVG in `chartSVG()`. No chart libraries.

## Run locally

```
npx -y serve -l 5179 .        # from the feels-like directory
```
Then open http://localhost:5179 (a static server is required — ES modules don't
load from file://). Smoke test: `/?mock=dry-heat,humid-heat`, then a real search
("Jackson MS", "39201"), toggle °C, star a favorite, reload (panels restore).

## Deploy (GitHub Pages)

Push to `main` on GitHub, then: repo **Settings → Pages → Deploy from a branch →
`main` / `(root)`**. The site appears at `https://<user>.github.io/feels-like/`.
No workflow file needed. `.nojekyll` is committed to skip Jekyll processing.

## Common tasks

- **Tune the formula**: edit `TUNING` in `js/feelslike.js` only; update the
  regression numbers above; check `?mock=dry-heat` vs `?mock=humid-heat` still
  land ~99° vs ~110°-ish at 3pm.
- **Change a palette**: edit the mood block at the top of `style.css` (day and
  night); preview with `?mock=<mood>` / `?mock=<mood>&night`.
- **Add a data point to the ledger**: add a component in `computeFeelsLike()`
  (give it a `key`), add its detail string in `ledgerHTML()`'s `details` map.
- **Add a new weather glyph**: add a path set to `GLYPHS` and map codes in
  `glyphKey()` (WMO weather codes).
