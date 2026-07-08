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
7. **Commit messages are user-facing.** The version history page
   (changelog.html) renders commit messages verbatim from the GitHub API.
   Write the title as what changed in plain English and the body as details a
   user would care about; trailer lines (Co-Authored-By etc.) are stripped
   automatically. Tag each release `vX.Y` and push tags — see "Releasing".

## File map

| File | Responsibility |
|---|---|
| `index.html` | Static shell: masthead, search form, favorites nav, `#panels`, explainer footer, calc modal `<dialog>` |
| `css/style.css` | All styles. `:root` holds only a fallback palette — live colors come from theme.js |
| `js/app.js` | State + all event handling. Owns `state`, calls renderers |
| `js/ui.js` | All rendering (panels, ledger, SVG chart, week strip, glyphs). No fetching, no storage |
| `js/theme.js` | The sky clock: time-of-day background, weather tint, derived text colors, temperature accent |
| `js/feelslike.js` | The formula (`computeFeelsLike`) + mood classification (`classifyMood`). All constants in `TUNING` |
| `js/explain.js` | "Show your work" modals: live source via `Function.toString()`, live TUNING values, citations |
| `js/api.js` | All network: Open-Meteo forecast + geocoding, Zippopotam (ZIPs), BigDataCloud (reverse geocode) |
| `js/mock.js` | Synthetic weather scenarios for offline testing / theme previews |
| `js/storage.js` | localStorage wrapper (`feelslike:unit`, `feelslike:favorites`, `feelslike:active`) |
| `changelog.html` + `js/changelog.js` | Version history page: GitHub tags become headings, commit messages become entries |

Data flow: search → `api.searchPlaces` → user picks → `api.fetchWeather` →
`app.loadPanel` stores `{loc, data, status}` in `state.panels[slot]` →
`ui.renderAll(state)` re-renders everything and calls `theme.applyTheme()`.

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
  expanded via the `US_STATES` map). The qualified retry fetches `count=100`
  because the geocoder ranks by population — small towns (Madison, MS) never
  appear in the top few "Madison"s; the filter is what surfaces them. Don't
  remove that fallback or shrink that count.
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
- **Wind**: the published NWS wind chill formula
  (WC = 35.74 + 0.6215T − 35.75V^0.16 + 0.4275TV^0.16), applied strictly in
  its defined domain — air temp ≤ 50°F and wind ≥ 3 mph. At ≥ 65°F an
  evaporative-cooling model applies instead (wind helps more when the air is
  dry); between 50–65°F the two are blended linearly so there is no seam.
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

## The theme (js/theme.js — the sky clock)

The palette is computed per render by `theme.applyTheme()` from the **primary
panel's** data and set as inline CSS variables on `<html>` (which override the
static `:root` fallback in style.css). Three layers:

1. **Sky**: keyframe colors anchored to the location's actual sunrise/sunset
   (from the API's `daily.sunrise/sunset`), interpolated minute-by-minute —
   night → indigo first light → rose horizon → sunrise gold → morning → pale
   blue solar noon → afternoon → golden hour → sunset orange → dusk violet →
   night. Edit the stops in `skyStops()`.
2. **Weather tint**: `weatherTint()` mixes a tint into the sky by WMO code
   family (thunder, snow, rain, drizzle, fog, overcast, partly). Strengths are
   capped ≲ 0.42 so time of day always shows through; night halves them.
3. **Derived text + accent**: `--ink/--muted/--line` are mixed from the final
   background by luminance (threshold 0.32 flips dark/light ink), so contrast
   is guaranteed — never hand-set text colors. `--accent` comes from
   `classifyMood(feelsLike, dewPoint)` (same table as before: ≥85 humid/dry
   heat split at dew point 62, then warm/mild/chill/cold at 70/55/38) with an
   on-light and on-dark variant per mood in `ACCENTS`.

To preview: `?mock=<scenario>&hour=<0–23>` steps the sky clock;
scenarios carry the weather (e.g. `chill` is rain, `cold` is snow).

## Mock mode — test without the network

- `./?mock=humid-heat` — one scenario (names = `SCENARIOS` keys in `js/mock.js`)
- `./?mock=dry-heat,humid-heat` — compare mode
- `./?mock=warm&hour=6` — any hour 0–23; this is how you preview the sky clock
  (sunrise ≈ 6:12, sunset ≈ 20:24 in mock data)
- `./?mock=warm&night` — shorthand for 10pm
- Mock "now" is pinned (3pm default) so scenarios are deterministic whenever
  you run them. Mock locations are never written to localStorage.

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

Pages is already enabled (deploy from branch, `main` / root). **Every push to
`main` redeploys the live site** at `https://zacheddington.github.io/feels-like/`
within a minute or two. `.nojekyll` is committed to skip Jekyll processing.

## Releasing & the changelog

The version history page (changelog.html) is generated from the repository:
tags become version headings, commit messages become the entries under them.
Releasing is therefore just git hygiene:

1. Write the commit message **for end users** — plain-English title, body
   listing what they'll notice. It will be displayed verbatim.
2. Tag the release commit and push both:
   `git tag vX.Y && git push && git push --tags`
3. Versions are `v1.0`, `v1.1`, … — bump the minor for feature releases,
   patch (`v1.1.1`) for small fixes. Untagged commits newer than the latest
   tag appear on the page under "next / not yet released", so don't leave
   `main` untagged for long.

## Common tasks

- **Tune the formula**: edit `TUNING` in `js/feelslike.js` only; update the
  regression numbers above; check `?mock=dry-heat` vs `?mock=humid-heat` still
  land ~99° vs ~110°-ish at 3pm. The calculation modals display TUNING and the
  function source live, so they need no updates.
- **Change the sky or weather tinting**: edit `skyStops()` / `weatherTint()` /
  `ACCENTS` in `js/theme.js`; preview with `?mock=<scenario>&hour=<0-23>`.
- **Add a data point to the ledger**: add a component in `computeFeelsLike()`
  (give it a `key`), add its detail string in `ledgerHTML()`'s `details` map,
  and add a matching entry (same key) to `ENTRIES` in `js/explain.js` so its
  ledger row has a modal.
- **Change what a calculation modal says**: prose/citations live in `ENTRIES`
  in `js/explain.js`. The code block and constants render themselves from the
  live module — never paste code into the modal text.
- **Add a new weather glyph**: add a path set to `GLYPHS` and map codes in
  `glyphKey()` (WMO weather codes).
