// feedback.js — the "disagree with this number?" loop.
//
// Opens a dialog asking what it actually feels like, snapshots the full
// conditions alongside the user's answer, and submits the pair. Disagreements
// are labeled training data for tuning the formula (see CLAUDE.md,
// "The feedback loop", for how to analyze them).
//
// Two destinations:
//  1. A Google Form (preferred): set FEEDBACK_FORM.action and the field entry
//     ids below, and submissions land silently in the connected Sheet.
//     Wiring steps are in CLAUDE.md.
//  2. Until the form is configured: opens a pre-filled email draft instead,
//     so no feedback is lost in the meantime.

import { computeFeelsLike } from './feelslike.js';

export const FEEDBACK_FORM = {
  // e.g. 'https://docs.google.com/forms/d/e/<form-id>/formResponse'
  action: '',
  fields: {
    felt: 'entry.0000001',      // their number, °F
    ours: 'entry.0000002',      // our number, °F
    snapshot: 'entry.0000003',  // full conditions JSON
  },
};

const FALLBACK_EMAIL = 'zacheddington@gmail.com';

let pending = null; // { snapshot, unit } for the currently open dialog

export function openFeedback(entry, unit) {
  if (!entry || !entry.data) return;
  const c = entry.data.current;
  const feel = computeFeelsLike({
    temp: c.temperature_2m,
    dewPoint: c.dew_point_2m,
    rh: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    radiation: c.shortwave_radiation,
  });
  pending = {
    unit,
    snapshot: {
      place: `${entry.loc.name}${entry.loc.region ? ', ' + entry.loc.region : ''}`,
      lat: +(+entry.loc.lat).toFixed(2),
      lon: +(+entry.loc.lon).toFixed(2),
      localTime: c.time,
      airF: Math.round(c.temperature_2m),
      dewPointF: Math.round(c.dew_point_2m),
      humidityPct: Math.round(c.relative_humidity_2m),
      windMph: Math.round(c.wind_speed_10m),
      radiationWm2: Math.round(c.shortwave_radiation || 0),
      weatherCode: c.weather_code,
      oursF: Math.round(feel.value),
      mock: !!entry.loc.mock || undefined,
    },
  };
  const dlg = document.getElementById('feedbackModal');
  document.getElementById('feedbackUnit').textContent = unit;
  const input = document.getElementById('feedbackTemp');
  input.value = '';
  document.getElementById('feedbackStatus').textContent = '';
  dlg.showModal();
  input.focus();
}

async function submit(feltEntered) {
  const { unit, snapshot } = pending;
  const feltF = Math.round(unit === 'C' ? (feltEntered * 9) / 5 + 32 : feltEntered);
  const payload = { ...snapshot, feltF, enteredAs: `${feltEntered}°${unit}` };

  if (FEEDBACK_FORM.action) {
    const body = new FormData();
    body.append(FEEDBACK_FORM.fields.felt, String(feltF));
    body.append(FEEDBACK_FORM.fields.ours, String(snapshot.oursF));
    body.append(FEEDBACK_FORM.fields.snapshot, JSON.stringify(payload));
    // no-cors: Google Forms accepts the POST; the response is opaque by design
    await fetch(FEEDBACK_FORM.action, { method: 'POST', mode: 'no-cors', body });
    return 'sent — thank you, this is what tunes the formula';
  }

  const subject = encodeURIComponent(`Feels Like feedback: ${snapshot.place}`);
  const bodyTxt = encodeURIComponent(
    `We said ${snapshot.oursF}°F, they say ${feltF}°F.\n\n${JSON.stringify(payload, null, 2)}`);
  window.location.href = `mailto:${FALLBACK_EMAIL}?subject=${subject}&body=${bodyTxt}`;
  return 'opening an email draft — hit send to deliver it';
}

export function initFeedback() {
  const dlg = document.getElementById('feedbackModal');
  if (!dlg) return;
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
  document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = parseFloat(document.getElementById('feedbackTemp').value);
    if (Number.isNaN(val) || !pending) return;
    const status = document.getElementById('feedbackStatus');
    try {
      status.textContent = await submit(val);
      setTimeout(() => dlg.close(), 2000);
    } catch {
      status.textContent = 'couldn’t send right now — try again in a moment';
    }
  });
}
