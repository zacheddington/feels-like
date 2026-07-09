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
| `js/feedback.js` | "Disagree with this number?" loop: conditions snapshot + user's felt temp → Google Form (or email fallback until configured) |
| `manifest.webmanifest` + `sw.js` + `icons/` | PWA layer: installable, offline-capable (network-first shell, cached last weather) |
| `tools/audit-contrast.mjs` | Accessibility gate: sweeps every sky × weather × mood palette against the contrast floors |
| `tools/make-icons.mjs` | Regenerates the PNG icons from code (`node tools/make-icons.mjs`) |

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
  remove that fallback or shrink that count. Up to ~12 results are returned;
  the dropdown scrolls. `promoteNearby()` in app.js floats the 3 results
  closest to the primary panel's location (within ~350 mi) to the top with a
  "nearby" tag — people usually search near where they already are.
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

The hero also shows a **shade counterfactual** ("in the shade, more like N°")
whenever the sun component is ≥ 2°F — it's simply `value − sun delta`,
computed in `heroHTML()` (ui.js), not a separate formula.

**Queued formula idea (do NOT implement without feedback data):** scale
mugginess by total heat load (air temp + sun) instead of air temp alone —
matches both "humid shade brings little relief" and "dry sun runs hot"
reports. Validate against feedback rows first (see The feedback loop).

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
3. **Contrast enforcement (do not weaken)**: backgrounds are pushed out of
   the luminance "dead zone" (`escapeDeadZone`, L 0.095–0.315) where no text
   color can reach 7:1 — twilight and fog land there constantly. Then
   `ensureContrast()` guarantees the floors in `CONTRAST_FLOORS`: ink ≥ 7:1,
   muted ≥ 4.5:1, accent ≥ 4.5:1 against the final background. Never hand-set
   text colors; never bypass these floors. `--accent` starts from
   `classifyMood(feelsLike, dewPoint)` (≥85 humid/dry heat split at dew point
   62, then warm/mild/chill/cold at 70/55/38) with on-light/on-dark variants
   in `ACCENTS`, then gets contrast-corrected.

**After ANY change to theme.js, run `node tools/audit-contrast.mjs`** — it
sweeps ~28k palette combinations and exits non-zero on any floor violation.

To preview: `?mock=<scenario>&hour=<0–23>` steps the sky clock;
scenarios carry the weather (e.g. `chill` is rain, `cold` is snow).
`computePalette()` is pure (no DOM); `applyTheme()` applies it to CSS
variables, `body[data-mood]/[data-night]`, the `theme-color` meta, and a
localStorage copy (`feelslike:palette`) that an inline script in each page's
`<head>` restores before first paint to prevent a daylight flash at night.

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
   listing what they'll notice. It will be displayed verbatim. Hard-wrapping
   the body is fine: the changelog page unwraps single newlines into spaces
   (blank lines = paragraph breaks; lines starting with `-`/`*`/digits keep
   their breaks, so lists survive).
2. **Bump `VERSION` in `sw.js`** to match the release tag — this is what
   retires the old offline cache on users' devices. Skipping it means users
   may run a stale shell offline.
3. If theme.js changed, `node tools/audit-contrast.mjs` must pass.
4. Tag the release commit and push both:
   `git tag vX.Y && git push && git push --tags`
5. Versions are `v1.0`, `v1.1`, … — bump the minor for feature releases,
   patch (`v1.1.1`) for small fixes. Untagged commits newer than the latest
   tag appear on the page under "next / not yet released", so don't leave
   `main` untagged for long.

## Data freshness

Weather is fetched per panel on load and then kept fresh automatically:
silent re-fetch (no loading flash — `loadPanel(slot, loc, { silent: true })`)
on `visibilitychange` resume when data is >5 min old, plus every 15 min while
visible. The hero shows "updated N min ago" as a **tappable refresh button**
(`{ manual: true }` keeps data visible and shows a spinner). Error panels get
a **"try again"** button — both use the same `refresh` action, which re-runs
`loadPanel` for that slot's `loc`, so a 502 is never a dead end. When the
service worker serves a cached API response offline it sets an
`X-Feels-Like-Cache: fallback` header; api.js turns that into
`data._fromCache` and the UI labels it "offline — showing data from N min
ago". If a silent refresh fails, the old data stays and its age label keeps
counting — never blank a panel that has data.

## The feedback loop (js/feedback.js)

Users can tap "disagree with this number?" under the ledger and enter what it
feels like to them. The submission carries a full conditions snapshot (air,
dew point, humidity, wind, radiation, weather code, our value `oursF`, the
shade value `shadeF`, theirs `feltF`, place, local time, and `exposure`) —
labeled data for tuning TUNING.

The felt-temperature input is magnitude-only (`min="0"`) with a `±` sign
toggle beside it (`#feedbackSign`) — phone number pads have no minus key, so
the toggle is the only reliable way to report a below-zero feels-like; the
sign is applied in the submit handler before the °C→°F conversion.

**Exposure matters for analysis:** `oursF` includes the sun component, so a
shade reporter is really comparing against `shadeF`. When the sun component
is ≥ 2°F the dialog requires a sun/shade/indoors choice (`exposure`); below
that it records `sun-not-a-factor`. When analyzing: compare sun reports to
`oursF`, shade reports to `shadeF`, and drop `indoors` / `unspecified`. Rows
from before v1.6 have no exposure field — treat daytime ones as ambiguous.

**The Google Form IS configured** (since v1.5, 2026-07-08) — submissions post
silently to Zach's form; responses live in the form's Responses tab (a Sheet
can be linked later without breaking anything). Two wiring-test rows exist
from setup (snapshot says "wiring test" / `mock: true`) — exclude them from
analysis. If the form ever changes, re-derive the wiring like this:
1. Create a Google Form with three "short answer" questions: felt, ours,
   snapshot.
2. Get a pre-filled link (⋮ → Get pre-filled link), fill dummy values, copy
   the generated URL. It contains `entry.NNNNNNN=` ids for each question.
3. In js/feedback.js set `FEEDBACK_FORM.action` to
   `https://docs.google.com/forms/d/e/<form-id>/formResponse` (replace
   `/viewform` with `/formResponse`) and map the three entry ids.
4. Responses land in the linked Sheet. To analyze: File → Share → publish the
   sheet as CSV, then regress `feltF − oursF` against the snapshot components
   to see which TUNING constant is off. Don't hand-tune on vibes; wait for
   enough rows.

## Favorites backup

localStorage is evictable (especially iOS home-screen apps after disuse).
The "backup my favorites" link in the footer copies a `?restore=<base64>`
link encoding favorites + unit; opening it on any device merges them in and
cleans the URL (see `init()` in app.js).

## UI conventions worth knowing

- **Every `<dialog>` must carry `class="modal"`** — that class provides the
  centered, sky-palette frame. A dialog without it renders unstyled at the
  top-left (this was a real shipped bug).
- Compare mode: while a compare pick is pending (`state.searchTarget === 1`),
  favorite chips fill slot 1 instead of slot 0. On screens ≤880px, compare
  renders two condensed side-by-side columns (charts/week/meta hidden via the
  `.panels.compare` media block in style.css) — comparison is glanceable, not
  scrollable.
- `?debug` in the URL shows a per-device Open-Meteo call meter in the footer
  (`getUsage()` in api.js; counts stored 14 days in `feelslike:apicalls`).
  There is no account or central quota — every visitor calls Open-Meteo from
  their own IP under the fair-use limit (~10k calls/day per client).

## PWA notes

- The app is installable (Add to Home Screen) and works offline: `sw.js`
  serves the shell network-first (fresh when online, cached when not) and
  falls back to the last cached weather-API responses offline.
- iOS specifics already handled — don't regress them: `viewport-fit=cover` +
  `env(safe-area-inset-*)` body padding, `html` background painted (prevents
  unpainted status-bar/overscroll bands), fixed overlays overdrawn past the
  viewport, `theme-color` synced to `--bg` on every theme apply.
- Icon changes: edit `tools/make-icons.mjs` and re-run it; never hand-edit
  the PNGs. After changing icons or manifest, users must remove and re-add
  the home-screen icon to see the change.
- The icon set includes `icon-mono.png` (white glyph on transparency) served
  with manifest purpose `"monochrome"` for Android themed icons. iOS tinted
  home screens auto-tint the regular icon — no web API exists to supply
  explicit variants there, so keep the glyph a single bold shape.

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
