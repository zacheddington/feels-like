# Feels Like — Pre-Deployment Test Plan

**THE RULE: every test in this document must PASS before any commit is pushed
to `main` (which auto-deploys the live site). If even one test FAILS, do not
deploy. Fix the problem, then run the whole plan again from the top.**

This plan is written to be run mechanically. Most tests are copy-paste
snippets that check themselves and return `pass: true` or `pass: false` — you
do not have to judge whether something "looks right," you compare the returned
value to what this document says to expect. When in doubt, a test FAILS.

---

## 0. How to run this (read first)

You need two kinds of tool:

- **A terminal** (Bash or PowerShell) — for the automated code checks in §1
  and the git/deploy steps.
- **The browser preview tools** — `preview_start`, `preview_eval`,
  `preview_screenshot`, `preview_resize`, `preview_console_logs`. These drive
  the app in a real browser.

### Running a snippet

Many tests below give a JavaScript snippet. To run one:

1. Make sure the preview server is started (Test 0.1).
2. Call `preview_eval` with the snippet as the `expression`.
3. Read the returned JSON. **Every field named `pass` must be `true`.** If any
   `pass` is `false`, that test FAILS.

Snippets that search or refresh use the real network and contain `await` and
`setTimeout` — they take a few seconds. That is expected. If a network snippet
returns all `pass: false`, retry once (the weather service may have hiccuped);
if it fails twice, it is a real failure.

### Recording results

Fill in the checklist in §16 as you go: `PASS`, `FAIL`, or `BLOCKED` (could not
run). The build is deployable **only when every row says PASS**.

### If you changed the formula (`js/feelslike.js` `TUNING`) on purpose

Some expected numbers below (the formula regression in §2, and the mock hero
values in §4) depend on the current formula. If you deliberately changed
`TUNING`, those numbers are *supposed* to change. In that case:

1. Recompute the three regression values (§2.1) and the mock hero values (§4.1)
   from the new formula.
2. Update them **both here and in `CLAUDE.md`** in the same commit.
3. Then the tests must pass against the new numbers.

Never just loosen a test to make it pass. A failing test means either the code
is wrong or the expected value was intentionally changed and must be updated
deliberately.

---

## 0.1 — Start the server (do this once)

1. `preview_start` with name `feels-like`. Note the `serverId` it returns; use
   it for every `preview_eval` / screenshot below.
2. Navigate to the app: `preview_eval` with
   `window.location.href = '/'; 'ok'`
3. Wait ~3 seconds, then run `preview_console_logs` at level `error`.

**Expected:** `preview_start` reports the server started (or reused). Console
shows **no errors**. (An error about geolocation being denied is acceptable —
that is the browser, not the app.)

**PASS if:** server is up and there are no JavaScript errors in the console.

---

## 1. Automated code checks (terminal)

These are the fastest and most important. Run them first.

### 1.1 — Contrast audit (accessibility gate)

Run in the terminal from the project root:

```
node tools/audit-contrast.mjs
```

**Expected:** the last line printed is exactly `all combinations pass.` and the
command exits with code 0. It also prints the minimum contrast found — ink must
be ≥ 7.00, muted ≥ 4.50, accent ≥ 4.50.

**PASS if:** you see `all combinations pass.` **FAIL if:** it prints
`FAILURES:` and exits non-zero.

### 1.2 — Icons regenerate cleanly

```
node tools/make-icons.mjs
```

**Expected:** prints four lines — `icons/icon-512.png`, `icons/icon-192.png`,
`icons/apple-touch-icon.png`, and `icons/icon-mono.png (…, monochrome)`. No
errors.

**PASS if:** all four files are reported written. After running, check `git
status` — if the PNGs changed unexpectedly (you did not intend an icon change),
that is a FAIL; revert them.

### 1.3 — Service-worker version was bumped (only if shell files changed)

This applies **only if you changed a file the service worker caches** — that is
any file in the `SHELL` list in `sw.js` (the HTML, CSS, JS, icons, or
manifest). If your change touched only docs (`*.md`), `tools/`, or the audit
script, the shell did not change and `VERSION` does **not** need to move — skip
this test and mark it PASS.

If you did change a shell file: open `sw.js`, read `const VERSION = 'vX.Y.Z';`,
and compare to the deployed version:

```
curl -s "https://zacheddington.github.io/feels-like/sw.js" | grep VERSION
```

**PASS if:** either (a) no shell file changed, or (b) the local `VERSION` is
**higher** than the deployed one. **FAIL if:** you changed a shell file but the
version is unchanged (offline users would keep stale code).

---

## 2. Formula correctness (snippet)

### 2.1 — Regression values, wind-chill domain, mood boundaries

Run this snippet:

```js
(async () => {
  const m = await import('/js/feelslike.js');
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const reg = [
    { in:{temp:91,dewPoint:74,rh:57,wind:5,radiation:900},  exp:109.96 }, // humid MS afternoon
    { in:{temp:91,dewPoint:30,rh:11,wind:8,radiation:900},  exp:98.62  }, // dry NM afternoon
    { in:{temp:35,dewPoint:32,rh:90,wind:15,radiation:0},   exp:22.43  }, // raw damp winter
  ].map(c => ({ exp:c.exp, got:+m.computeFeelsLike(c.in).value.toFixed(2),
                pass: near(m.computeFeelsLike(c.in).value, c.exp) }));
  return {
    regression: reg,
    windChillIsNWSbelow50: { pass: Math.abs(m.windEffect(40,15,30) - m.nwsChillDelta(40,15)) < 0.01 },
    windIsZeroWhenCalm:     { pass: m.windEffect(40, 2, 30) === 0 },   // below 3 mph
    moodHumidHeat: { pass: m.classifyMood(90, 70) === 'humid-heat' },
    moodDryHeat:   { pass: m.classifyMood(90, 40) === 'dry-heat' },
    moodWarm:      { pass: m.classifyMood(75, 50) === 'warm' },
    moodMild:      { pass: m.classifyMood(60, 45) === 'mild' },
    moodChill:     { pass: m.classifyMood(45, 40) === 'chill' },
    moodCold:      { pass: m.classifyMood(20, 10) === 'cold' },
  };
})()
```

**Expected:** every `pass` is `true`; the three regression `got` values equal
109.96, 98.62, 22.43.

**PASS if:** all `pass: true`. **If regression fails** and you changed `TUNING`
on purpose, follow the instructions in §0 to update the expected numbers.

---

## 3. Sky-clock theme + contrast (snippet)

### 3.1 — Palette phases differ, weather tints, contrast holds

```js
(async () => {
  const t = await import('/js/theme.js');
  const at = (hhmm, extra={}) => t.computePalette(Object.assign(
    { timeISO:`2026-07-07T${hhmm}`, sunriseISO:'2026-07-07T06:00', sunsetISO:'2026-07-07T20:00' }, extra));
  const night = at('03:00').vars['--bg'];
  const noon  = at('13:00').vars['--bg'];
  const dusk  = at('20:40').vars['--bg'];
  // contrast floors on a hard case (dusk, which used to fail)
  const p = at('20:40');
  const con = {
    ink:    +t.contrast(p.vars['--ink'],    p.vars['--bg']).toFixed(2),
    muted:  +t.contrast(p.vars['--muted'],  p.vars['--bg']).toFixed(2),
    accent: +t.contrast(p.vars['--accent'], p.vars['--bg']).toFixed(2),
  };
  // weather tint changes the bg but doesn't replace it
  const clear = at('13:00', {weatherCode:0}).vars['--bg'];
  const rain  = at('13:00', {weatherCode:63, cloudCover:100}).vars['--bg'];
  return {
    phasesAllDifferent: { pass: (night!==noon && noon!==dusk && night!==dusk) },
    nightIsDark:  { pass: t.luminance(night) < 0.15 },
    noonIsLight:  { pass: t.luminance(noon)  > 0.32 },
    inkContrastOK:    { val: con.ink,    pass: con.ink    >= 7 },
    mutedContrastOK:  { val: con.muted,  pass: con.muted  >= 4.5 },
    accentContrastOK: { val: con.accent, pass: con.accent >= 4.5 },
    rainTintApplied:  { pass: rain !== clear },
  };
})()
```

**Expected:** all `pass: true`. Night background is dark, noon is light, dusk is
readable, rain shifts the color.

**PASS if:** all `pass: true`.

### 3.2 — Live theme sets the browser chrome color

Navigate to `/?mock=humid-heat&hour=13`, wait 1.5s, then run:

```js
(() => {
  const bg = document.documentElement.style.getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]').content.trim();
  return { bg, meta, pass: bg.length === 7 && meta.toLowerCase() === bg.toLowerCase() };
})()
```

**Expected:** `pass: true` — the `theme-color` meta matches the live `--bg`.

---

## 4. Mock scenarios — offline UI (no network needed)

Mock mode renders the whole app from synthetic data, pinned to 3 PM by default.
Scenario names: `dry-heat`, `humid-heat`, `warm`, `mild`, `chill`, `cold`.

### 4.1 — Each scenario renders fully

For **each** scenario, navigate to `/?mock=<name>` (e.g. `/?mock=dry-heat`),
wait 1.5s, then run this snippet:

```js
(() => {
  const q = (s) => document.querySelector(s);
  const heroText = q('.hero-num')?.textContent.trim();
  const heroNum = parseInt(heroText, 10);
  return {
    hasHeroNumber:   { pass: !Number.isNaN(heroNum) },
    hasLedgerTotal:  { pass: !!q('.ledger .total') },
    hasLedgerRows:   { pass: document.querySelectorAll('.ledger .row').length >= 3 },
    hasChart:        { pass: !!q('.chart') },
    hasWeekStrip:    { pass: document.querySelectorAll('.week .day').length === 7 },
    hasLocalTime:    { pass: !!q('.local-time') },
    moodSet:         { pass: !!document.body.dataset.mood },
    heroValue: heroNum,
  };
})()
```

**Expected:** all `pass: true` for all six scenarios. For reference, with the
**current formula** the default-hour hero values are: `dry-heat` = **102**,
`humid-heat` = **110**. (If you changed `TUNING`, update these two numbers.)

**PASS if:** all six scenarios return all `pass: true`, and dry-heat/humid-heat
match the reference values (or the values you updated after a formula change).

### 4.2 — Shade line appears when the sun matters

Navigate to `/?mock=dry-heat` (full midday sun), wait 1.5s:

```js
(() => {
  const shade = document.querySelector('.shade-line');
  return { shadeShown: { pass: !!shade }, text: shade?.textContent.trim() };
})()
```

**Expected:** `shadeShown.pass: true`, text reads like "in the shade, more like
92°" (a lower number than the hero).

Then navigate to `/?mock=cold&hour=23` (night, no sun), wait 1.5s, run the same
snippet. **Expected:** `shadeShown.pass: false` — no shade line at night.

**PASS if:** shade line shows in midday sun and is absent at night.

### 4.3 — Sky clock steps through the day

Navigate to each of `/?mock=warm&hour=4`, `&hour=8`, `&hour=13`, `&hour=20`,
`&hour=23`. After each, take a `preview_screenshot`.

**Expected (visual):** backgrounds progress from dark (4) → warm dawn (8) → pale
(13) → orange/purple dusk (20) → dark (23). Text is readable in every one.

**PASS if:** the five screenshots clearly differ and text is legible in each.

### 4.4 — Compare mock renders two panels

Navigate to `/?mock=dry-heat,humid-heat`, wait 2s:

```js
(() => ({
  twoPanels:  { pass: document.querySelectorAll('.panel').length === 2 },
  twoNumbers: { pass: document.querySelectorAll('.hero-num').length === 2 },
  compareClass: { pass: document.getElementById('panels').classList.contains('compare') },
}))()
```

**Expected:** all `pass: true`.

---

## 5. Search (live network)

### 5.1 — City, ZIP, and qualified search

Navigate to `/`, wait 3s, then run this snippet (it types and waits for each
result set):

```js
(async () => {
  const inp = document.querySelector('#searchInput');
  const type = async (v) => {
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2800));
    return [...document.querySelectorAll('#suggestions li')].map(li => li.textContent.replace(/\s+/g,' ').trim());
  };
  const city = await type('Denver');
  const zip  = await type('39110');           // Madison, MS
  const qual = await type('Madison MS');
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    cityReturnsResults: { pass: city.length >= 1 && /Denver/.test(city[0]) },
    zipReturnsMadisonMS:{ pass: zip.length === 1 && /Madison/.test(zip[0]) && /Mississippi/.test(zip[0]) },
    zipStateSpelledOut: { pass: zip.length === 1 && !/, MS\b/.test(zip[0]) }, // full name, not abbrev
    qualifiedFindsMS:   { pass: qual.some(s => /Madison, Mississippi/.test(s)) },
    dropdownNotEmpty:   { pass: qual.length >= 1 },
  };
})()
```

**Expected:** all `pass: true`. Note `zipStateSpelledOut` checks the ZIP result
shows "Mississippi", not "MS".

### 5.2 — Proximity sorting puts nearby matches first

Load a primary city first, then search a common name:

```js
(async () => {
  const inp = document.querySelector('#searchInput');
  const pick = async (v) => {
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2800));
    document.querySelector('#suggestions li')?.click();
    await new Promise(r => setTimeout(r, 3500));
  };
  await pick('Jackson MS');                    // primary = Jackson, Mississippi
  inp.value = 'Madison'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2800));
  const items = [...document.querySelectorAll('#suggestions li')].map(li => li.textContent.replace(/\s+/g,' ').trim());
  const nearbyTags = document.querySelectorAll('#suggestions .sug-near').length;
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    primaryLoaded:  { pass: /Jackson, Mississippi/.test(document.querySelector('.place')?.textContent || '') },
    firstIsNearby:  { pass: /Mississippi|Alabama|Arkansas|Louisiana|Tennessee/.test(items[0] || '') },
    hasNearbyTags:  { pass: nearbyTags >= 1 },
    resultsCappedReasonably: { pass: items.length >= 1 && items.length <= 14 },
  };
})()
```

**Expected:** all `pass: true` — with Jackson, MS on screen, searching "Madison"
floats a nearby (Deep-South) Madison to the top with a "nearby" tag.

### 5.3 — Submit (Enter / search button) loads the top result

```js
(async () => {
  const inp = document.querySelector('#searchInput');
  inp.value = 'Seattle'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2800));
  document.getElementById('searchForm').requestSubmit();   // same as tapping the magnifier / Enter
  await new Promise(r => setTimeout(r, 3500));
  return { loaded: { pass: /Seattle/.test(document.querySelector('.place')?.textContent || '') } };
})()
```

**Expected:** `loaded.pass: true`.

---

## 6. Favorites

### 6.1 — Star, chip, persistence

```js
(async () => {
  const load = async (v) => {
    const inp = document.querySelector('#searchInput');
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2800));
    document.querySelector('#suggestions li')?.click();
    await new Promise(r => setTimeout(r, 3500));
  };
  await load('Austin TX');
  document.querySelector('[data-action="fav"]').click();   // star it
  await new Promise(r => setTimeout(r, 300));
  const chipAfterStar = [...document.querySelectorAll('.chip')].some(c => /Austin/.test(c.textContent));
  const stored = JSON.parse(localStorage.getItem('feelslike:favorites') || '[]');
  return {
    chipAppears:   { pass: chipAfterStar },
    storedToLocal: { pass: stored.some(f => /Austin/.test(f.name)) },
  };
})()
```

**Expected:** both `pass: true`. Then **reload the page** (`window.location.reload()`),
wait 3.5s, and confirm the Austin chip is still present:

```js
({ persistsAfterReload: { pass: [...document.querySelectorAll('.chip')].some(c => /Austin/.test(c.textContent)) } })
```

**Expected:** `pass: true`.

### 6.2 — Backup link round-trips

```js
(() => {
  const favs = JSON.parse(localStorage.getItem('feelslike:favorites') || '[]');
  if (!favs.length) return { setup: 'no favorites — run 6.1 first', pass: false };
  const payload = btoa(JSON.stringify({ f: favs, u: 'F' }));
  const decoded = JSON.parse(atob(payload));
  return { encodesAndDecodes: { pass: decoded.f[0].name === favs[0].name } };
})()
```

Then test a real restore: clear favorites and open a restore link.

```js
(() => {
  const one = [{ name:'Testville', region:'Ohio', lat:40.00, lon:-83.00 }];
  const payload = encodeURIComponent(btoa(JSON.stringify({ f: one, u: 'F' })));
  localStorage.removeItem('feelslike:favorites');
  window.location.href = '/?restore=' + payload;
  return 'navigating';
})()
```

Wait 3.5s, then:

```js
({
  restored:   { pass: [...document.querySelectorAll('.chip')].some(c => /Testville/.test(c.textContent)) },
  urlCleaned: { pass: location.search === '' },
})
```

**Expected:** both `pass: true` — the favorite is restored and the `?restore=`
is stripped from the URL.

---

## 7. Compare

### 7.1 — Compare via search and via favorite chip

```js
(async () => {
  const out = {};
  const load = async (v) => {
    const inp = document.querySelector('#searchInput');
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2800));
    document.querySelector('#suggestions li')?.click();
    await new Promise(r => setTimeout(r, 3500));
  };
  await load('Miami FL');
  document.querySelector('[data-action="fav"]').click();     // make a favorite to compare with
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-action="compare"]').click(); // enter compare mode
  await new Promise(r => setTimeout(r, 200));
  out.placeholderChanged = { pass: /compare/i.test(document.querySelector('#searchInput').placeholder) };
  document.querySelector('.chip[data-action="chip"]').click(); // pick the favorite as 2nd city
  await new Promise(r => setTimeout(r, 3500));
  out.twoPanels = { pass: document.querySelectorAll('.panel').length === 2 };
  out.compareLayout = { pass: document.getElementById('panels').classList.contains('compare') };
  return out;
})()
```

**Expected:** all `pass: true`.

### 7.2 — Mobile side-by-side compare

`preview_resize` to width **390**, height **844**. Navigate to
`/?mock=dry-heat,humid-heat`, wait 2s, then:

```js
(() => {
  const panels = document.querySelectorAll('.panels.compare .panel');
  if (panels.length !== 2) return { pass: false, reason: 'not two panels' };
  const a = panels[0].getBoundingClientRect(), b = panels[1].getBoundingClientRect();
  return {
    sideBySide:    { pass: Math.abs(a.top - b.top) < 40 && b.left > a.left }, // same row, second to the right
    chartsHidden:  { pass: !document.querySelector('.panels.compare .chart') }, // hidden on small compare
    bothNumbers:   { pass: document.querySelectorAll('.hero-num').length === 2 },
  };
})()
```

**Expected:** all `pass: true` — two columns on one row, charts hidden. Take a
`preview_screenshot` to confirm it reads cleanly. **After this test, resize back
to desktop:** `preview_resize` width **1280**, height **1400**.

---

## 8. Units

### 8.1 — °F/°C toggle converts and persists

Navigate to `/?mock=humid-heat`, wait 1.5s:

```js
(() => {
  const before = document.querySelector('.hero-num').textContent.trim();
  document.getElementById('unitToggle').click();
  const after = document.querySelector('.hero-num').textContent.trim();
  const unit = JSON.parse(localStorage.getItem('feelslike:unit'));
  const metaC = /km\/h/.test(document.querySelector('.meta').textContent);
  document.getElementById('unitToggle').click(); // back to F
  return {
    numberChanged: { pass: before !== after },
    storedC:       { pass: unit === 'C' },
    windInKmh:     { pass: metaC },
  };
})()
```

**Expected:** all `pass: true` — number changes (F→C), unit stored, wind shows
km/h in Celsius.

---

## 9. Data freshness & error recovery

### 9.1 — Age label + manual refresh

Navigate to `/?mock=dry-heat`, wait 1.5s:

```js
(async () => {
  const btn = document.querySelector('.age-btn');
  const isButton = btn && btn.tagName === 'BUTTON';
  const label = btn?.textContent.trim();
  if (btn) btn.click();                       // manual refresh
  await new Promise(r => setTimeout(r, 900));
  return {
    ageIsButton:      { pass: isButton },
    labelLooksRight:  { pass: /updated|refreshing|offline/.test(label || '') },
    refreshedOK:      { pass: /updated/.test(document.querySelector('.age-btn')?.textContent || '') },
  };
})()
```

**Expected:** all `pass: true`.

### 9.2 — Error state shows "try again" and recovers

This simulates a 502 by intercepting the forecast request, then restores it.

```js
(async () => {
  const out = {};
  const orig = window.fetch;
  window.fetch = (url, opts) =>
    (typeof url === 'string' && url.includes('/v1/forecast'))
      ? Promise.resolve(new Response('bad gateway', { status: 502 }))
      : orig(url, opts);
  const inp = document.querySelector('#searchInput');
  inp.value = 'Boston MA'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2800));
  document.querySelector('#suggestions li')?.click();
  await new Promise(r => setTimeout(r, 3200));
  out.errorShown = { pass: !!document.querySelector('.panel-note.err') };
  out.retryButtonShown = { pass: !!document.querySelector('.retry-btn') };
  window.fetch = orig;                         // network "recovers"
  document.querySelector('.retry-btn')?.click();
  await new Promise(r => setTimeout(r, 3500));
  out.recovered = { pass: /Boston/.test(document.querySelector('.place')?.textContent || '')
                          && !document.querySelector('.panel-note.err') };
  return out;
})()
```

**Expected:** all `pass: true` — the failed load shows an error + "try again",
and clicking it after recovery loads Boston with the error gone.

---

## 10. Feedback

### 10.1 — Dialog is centered and themed; sign toggle; exposure; submit

Navigate to `/?mock=dry-heat` (midday sun so the exposure question shows), wait
1.5s. This snippet intercepts the network so **no real feedback is sent**, then
inspects the exact payload:

```js
(async () => {
  const out = {};
  let captured = null;
  const orig = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.includes('formResponse') && opts?.body) {
      captured = {}; for (const [k, v] of opts.body.entries()) captured[k] = v.length > 60 ? JSON.parse(v) : v;
      return Promise.resolve(new Response('', { status: 200 }));  // swallow it
    }
    return orig(url, opts);
  };
  document.querySelector('.fb-trigger').click();
  await new Promise(r => setTimeout(r, 250));
  const dlg = document.getElementById('feedbackModal');
  const r = dlg.getBoundingClientRect();
  out.centered = { pass: Math.abs((r.left + r.width/2) - innerWidth/2) < 40 };
  out.themed   = { pass: getComputedStyle(dlg).backgroundColor !== 'rgb(255, 255, 255)' };
  out.exposureShown = { pass: !document.getElementById('feedbackExposure').hidden };
  // report −5°, in the shade
  document.getElementById('feedbackSign').click();                       // + -> −
  document.getElementById('feedbackTemp').value = '5';
  document.querySelector('#feedbackExposure input[value="shade"]').checked = true;
  document.getElementById('feedbackForm').requestSubmit();
  await new Promise(r => setTimeout(r, 1500));
  window.fetch = orig;
  const snap = captured ? Object.values(captured).find(v => typeof v === 'object') : null;
  out.sentNegative   = { pass: snap && snap.feltF === -5 };
  out.sentExposure   = { pass: snap && snap.exposure === 'shade' };
  out.hasShadeField  = { pass: snap && typeof snap.shadeF === 'number' };
  out.hasConditions  = { pass: snap && typeof snap.airF === 'number' && typeof snap.dewPointF === 'number' };
  return out;
})()
```

**Expected:** all `pass: true`. The sign toggle produced `feltF: -5`, the shade
choice was recorded, and the snapshot carries the shade value and conditions.

### 10.2 — Exposure question is hidden at night

Navigate to `/?mock=cold&hour=23`, wait 1.5s:

```js
(async () => {
  document.querySelector('.fb-trigger').click();
  await new Promise(r => setTimeout(r, 250));
  const hidden = document.getElementById('feedbackExposure').hidden;
  document.getElementById('feedbackModal').close();
  return { exposureHiddenAtNight: { pass: hidden } };
})()
```

**Expected:** `pass: true`.

### 10.3 — Invalid feedback input is rejected

Navigate to `/?mock=warm`, wait 1.5s:

```js
(async () => {
  document.querySelector('.fb-trigger').click();
  await new Promise(r => setTimeout(r, 250));
  const inp = document.getElementById('feedbackTemp');
  inp.value = '';                                   // empty
  const emptyBlocked = !document.getElementById('feedbackForm').checkValidity();
  inp.value = '999';                                // above max 150
  const overBlocked = !inp.checkValidity();
  document.getElementById('feedbackModal').close();
  return { emptyBlocked: { pass: emptyBlocked }, outOfRangeBlocked: { pass: overBlocked } };
})()
```

**Expected:** both `pass: true` — empty and out-of-range values fail validation
(the browser blocks submission).

---

## 11. Calculation modals

### 11.1 — Each term opens a modal with live code, tuning, citations

Navigate to `/?mock=dry-heat`, wait 1.5s, open the explainer and each modal:

```js
(async () => {
  document.querySelector('.explainer').open = true;
  const keys = ['muggy','dry','sun','wind','damp','colors'];
  const results = {};
  for (const k of keys) {
    document.querySelector(`[data-modal="${k}"]`).click();
    await new Promise(r => setTimeout(r, 150));
    const body = document.getElementById('calcModalBody').textContent;
    const hasCode = /function|=>/.test(body);
    document.getElementById('calcModal').close();
    results[k] = { pass: hasCode };
  }
  // wind modal specifically must contain the NWS formula constant and live TUNING
  document.querySelector('[data-modal="wind"]').click();
  await new Promise(r => setTimeout(r, 150));
  const wind = document.getElementById('calcModalBody').textContent;
  const cites = document.querySelectorAll('#calcModal .modal-cites a').length;
  document.getElementById('calcModal').close();
  results.windHasNWS   = { pass: wind.includes('35.74') };
  results.windHasTuning= { pass: wind.includes('CHILL_TEMP') };
  results.windHasCites = { pass: cites >= 1 };
  return results;
})()
```

**Expected:** all `pass: true` — every modal shows live function source; the
wind modal shows the NWS constant, the live TUNING keys, and citations.

### 11.2 — Modal fits the screen and the close button is reachable (mobile)

`preview_resize` to width **390**, height **844**. Navigate to `/?mock=dry-heat`,
wait 1.5s:

```js
(async () => {
  document.querySelector('.explainer').open = true;
  document.querySelector('[data-modal="wind"]').click();   // the tallest modal
  await new Promise(r => setTimeout(r, 200));
  const dlg = document.getElementById('calcModal');
  const box = dlg.getBoundingClientRect();
  const x = dlg.querySelector('[data-close]').getBoundingClientRect();
  const bodyScrolls = dlg.querySelector('.modal-body').scrollHeight > dlg.querySelector('.modal-body').clientHeight;
  document.getElementById('calcModal').close();
  return {
    topOnScreen:      { pass: box.top >= 0 },
    fitsHeight:       { pass: box.height <= innerHeight },
    closeButtonOnScreen: { pass: x.top >= 0 && x.bottom <= innerHeight },
    longBodyScrolls:  { pass: bodyScrolls },
  };
})()
```

**Expected:** all `pass: true`. **Resize back to desktop afterward** (width 1280,
height 1400).

---

## 12. PWA (installability + offline)

### 12.1 — Manifest and icons

```js
(async () => {
  const m = await fetch('/manifest.webmanifest').then(r => r.ok ? r.json() : null);
  const icon = async (p) => (await fetch(p)).ok;
  return {
    manifestLoads:  { pass: !!m && m.name === 'Feels Like' },
    standalone:     { pass: m && m.display === 'standalone' },
    hasMonochrome:  { pass: m && m.icons.some(i => i.purpose === 'monochrome') },
    icon512:  { pass: await icon('/icons/icon-512.png') },
    icon192:  { pass: await icon('/icons/icon-192.png') },
    iconApple:{ pass: await icon('/icons/apple-touch-icon.png') },
    iconMono: { pass: await icon('/icons/icon-mono.png') },
  };
})()
```

**Expected:** all `pass: true`.

### 12.2 — Service worker registers and caches the shell

Navigate to `/`, wait 3s (gives the SW time to install), then:

```js
(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  const cache = keys.length ? await caches.open(keys[0]) : null;
  const entries = cache ? (await cache.keys()).length : 0;
  return {
    registered:  { pass: !!reg },
    cacheExists: { pass: keys.length >= 1 },
    versionInName: { pass: keys.some(k => /feelslike-v\d/.test(k)) },
    shellCached: { pass: entries >= 15 },
  };
})()
```

**Expected:** all `pass: true` — a versioned cache exists holding the app shell
(15+ files).

---

## 13. Changelog page

### 13.1 — Loads, groups versions, clean text, wordmark links home

Navigate to `/changelog.html`, wait 3.5s (it fetches from GitHub):

```js
(() => {
  const versions = [...document.querySelectorAll('.log-version h2')].map(h => h.textContent);
  const bodies = [...document.querySelectorAll('.log-commit-body')];
  const link = document.querySelector('.wordmark-link');
  const bodyText = document.body.textContent;
  return {
    versionsListed:    { pass: versions.length >= 3 && versions.includes('v1.0') },
    commitsShown:      { pass: document.querySelectorAll('.log-commit').length >= 3 },
    noMidSentenceBreaks: { pass: !bodies.some(p => p.textContent.includes('\n')) },
    noTrailerLeak:     { pass: !/Co-Authored-By/.test(bodyText) },
    wordmarkLinksHome: { pass: !!link && link.getAttribute('href') === './index.html' },
    skyThemeApplied:   { pass: document.documentElement.style.getPropertyValue('--bg').trim().length === 7 },
  };
})()
```

**Expected:** all `pass: true`. If `versionsListed` fails, confirm the machine
has internet — the changelog reads live from the GitHub API. (An offline
failure here is a BLOCKED result, not a code FAIL, but you cannot deploy until
you can confirm it.)

---

## 14. Empty state & first-run

### 14.1 — Empty state when there is no saved data

```js
(() => {
  localStorage.removeItem('feelslike:active');
  localStorage.removeItem('feelslike:favorites');
  window.location.href = '/';
  return 'navigating';
})()
```

Wait 2s (the app will also try geolocation; that is fine), then:

```js
({
  emptyPromptShown: { pass: !!document.querySelector('.empty') || document.querySelectorAll('.panel').length >= 1 },
  hasGeolocateButton: { pass: !!document.querySelector('[data-action="geolocate"]') || document.querySelectorAll('.panel').length >= 1 },
})
```

**Expected:** either the "Where are you?" empty state is shown with a "use my
location" button, **or** geolocation already resolved and a panel is showing.
Both are acceptable — `pass: true` either way.

---

## 15. Whole-app sweep — console must be clean

After running the sections above, do a final navigation and console check.

1. Navigate to `/?mock=humid-heat`, wait 2s.
2. Run `preview_console_logs` at level `error`.
3. Navigate to `/changelog.html`, wait 3s.
4. Run `preview_console_logs` at level `error` again.

**Expected:** no JavaScript errors on either page. (A one-off network error line
from a deliberately-simulated failure earlier does not count — this is a fresh
check.)

**PASS if:** both pages produce no console errors.

---

## 16. Results checklist (fill this in every run)

Mark each PASS / FAIL / BLOCKED. **Deploy only if every row is PASS.**

| #    | Test                                        | Result |
|------|---------------------------------------------|--------|
| 0.1  | Server starts, no console errors            |        |
| 1.1  | Contrast audit passes                       |        |
| 1.2  | Icons regenerate cleanly                    |        |
| 1.3  | Service-worker VERSION bumped               |        |
| 2.1  | Formula regression + mood + wind domain     |        |
| 3.1  | Palette phases + contrast + weather tint    |        |
| 3.2  | theme-color meta syncs to --bg              |        |
| 4.1  | All 6 mock scenarios render fully           |        |
| 4.2  | Shade line shows in sun, hidden at night    |        |
| 4.3  | Sky clock steps through the day (visual)    |        |
| 4.4  | Compare mock renders two panels             |        |
| 5.1  | City / ZIP / qualified search               |        |
| 5.2  | Proximity "nearby" sorting                  |        |
| 5.3  | Submit loads top result                     |        |
| 6.1  | Favorite star + chip + persistence          |        |
| 6.2  | Backup link round-trips                     |        |
| 7.1  | Compare via search and favorite chip        |        |
| 7.2  | Mobile side-by-side compare                 |        |
| 8.1  | Unit toggle converts + persists             |        |
| 9.1  | Age label + manual refresh                  |        |
| 9.2  | Error state + try-again recovery            |        |
| 10.1 | Feedback: centered/themed, sign, exposure   |        |
| 10.2 | Exposure hidden at night                    |        |
| 10.3 | Invalid feedback input rejected             |        |
| 11.1 | Calc modals show live code + cites          |        |
| 11.2 | Modal fits mobile, close reachable          |        |
| 12.1 | Manifest + icons                            |        |
| 12.2 | Service worker registers + caches shell     |        |
| 13.1 | Changelog loads, clean text, links home     |        |
| 14.1 | Empty / first-run state                     |        |
| 15   | Whole-app console clean                      |        |

**If every row is PASS:** proceed with the release steps in `CLAUDE.md`
("Releasing & the changelog").

**If any row is FAIL:** do not deploy. Fix the cause, then re-run this entire
plan from §0.1. A partial re-run is not sufficient — a fix can break something
that passed earlier.
