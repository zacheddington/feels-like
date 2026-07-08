// audit-contrast.mjs — sweep every palette the sky clock can produce and
// verify the WCAG contrast floors hold (see CONTRAST_FLOORS in js/theme.js).
//
//   node tools/audit-contrast.mjs
//
// Exits non-zero if any combination fails, so it can gate a release. Also
// reports how often ensureContrast() had to intervene versus the raw hue
// mixes — that's the measure of how unreadable twilight would be without it.

import {
  computePalette, contrast, CONTRAST_FLOORS, mix, luminance, ACCENTS,
} from '../js/theme.js';

const SUN_TIMES = [
  { label: 'summer', sunriseISO: '2026-07-07T06:12', sunsetISO: '2026-07-07T20:24' },
  { label: 'winter', sunriseISO: '2026-01-07T07:41', sunsetISO: '2026-01-07T17:19' },
];
const WEATHER = [
  { label: 'clear', code: 0, cloud: 0 },
  { label: 'partly', code: 2, cloud: 40 },
  { label: 'overcast', code: 3, cloud: 100 },
  { label: 'fog', code: 45, cloud: 100 },
  { label: 'drizzle', code: 55, cloud: 100 },
  { label: 'rain', code: 63, cloud: 100 },
  { label: 'snow', code: 73, cloud: 90 },
  { label: 'thunder', code: 95, cloud: 100 },
];
const MOODS = [
  { label: 'humid-heat', feelsLike: 95, dewPoint: 70 },
  { label: 'dry-heat', feelsLike: 95, dewPoint: 40 },
  { label: 'warm', feelsLike: 75, dewPoint: 50 },
  { label: 'mild', feelsLike: 60, dewPoint: 45 },
  { label: 'chill', feelsLike: 45, dewPoint: 40 },
  { label: 'cold', feelsLike: 20, dewPoint: 10 },
];

const min = { ink: Infinity, muted: Infinity, accent: Infinity, line: Infinity };
const clamped = { ink: 0, muted: 0, accent: 0 };
let checks = 0;
const failures = [];

for (const sun of SUN_TIMES) {
  for (let minute = 0; minute < 1440; minute += 5) {
    for (const w of WEATHER) {
      for (const m of MOODS) {
        const p = computePalette({
          nowMinute: minute,
          sunriseISO: sun.sunriseISO, sunsetISO: sun.sunsetISO,
          weatherCode: w.code, cloudCover: w.cloud,
          feelsLike: m.feelsLike, dewPoint: m.dewPoint,
        });
        const bg = p.vars['--bg'];
        const got = {
          ink: contrast(p.vars['--ink'], bg),
          muted: contrast(p.vars['--muted'], bg),
          accent: contrast(p.vars['--accent'], bg),
          line: contrast(p.vars['--line'], bg),
        };
        checks++;
        for (const role of ['ink', 'muted', 'accent']) {
          min[role] = Math.min(min[role], got[role]);
          if (got[role] < CONTRAST_FLOORS[role] - 1e-9) {
            failures.push(`${sun.label} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} ${w.label} ${m.label}: ${role} ${got[role].toFixed(2)} < ${CONTRAST_FLOORS[role]}`);
          }
        }
        min.line = Math.min(min.line, got.line);

        // How the raw mixes (pre-ensureContrast) would have scored.
        const lightBg = luminance(bg) > 0.32;
        const inkBase = lightBg ? mix('#241f18', bg, 0.10) : mix('#f5f1e6', bg, 0.12);
        if (contrast(inkBase, bg) < CONTRAST_FLOORS.ink) clamped.ink++;
        if (contrast(mix(inkBase, bg, 0.42), bg) < CONTRAST_FLOORS.muted) clamped.muted++;
        const accentBase = ACCENTS[p.mood][lightBg ? 0 : 1];
        if (contrast(accentBase, bg) < CONTRAST_FLOORS.accent) clamped.accent++;
      }
    }
  }
}

console.log(`palettes checked: ${checks}`);
console.log(`minimum contrast found — ink ${min.ink.toFixed(2)} (floor ${CONTRAST_FLOORS.ink}), muted ${min.muted.toFixed(2)} (floor ${CONTRAST_FLOORS.muted}), accent ${min.accent.toFixed(2)} (floor ${CONTRAST_FLOORS.accent}), line ${min.line.toFixed(2)} (decorative, no floor)`);
console.log(`raw mixes that would have failed without ensureContrast — ink: ${clamped.ink}, muted: ${clamped.muted}, accent: ${clamped.accent}`);
if (failures.length) {
  console.error(`\nFAILURES: ${failures.length}`);
  for (const f of failures.slice(0, 40)) console.error('  ' + f);
  process.exit(1);
}
console.log('\nall combinations pass.');
