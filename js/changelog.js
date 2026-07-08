// changelog.js — the version history page.
//
// Pulls tags and commits from the public GitHub API (no key; 60 requests/hour
// per visitor IP, far more than this page needs) and renders commits grouped
// under version tags. The commit messages ARE the changelog — which is why
// CLAUDE.md insists commit messages be written for end users.

import { applyTheme } from './theme.js';

const REPO = 'zacheddington/feels-like';
const API = `https://api.github.com/repos/${REPO}`;

// Sky clock with the browser's local time; no weather data on this page.
applyTheme();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Trailer lines are process noise, not changelog content.
function cleanMessage(msg) {
  return msg
    .split('\n')
    .filter((line) => !/^(Co-Authored-By|Signed-off-by):/i.test(line) && !line.includes('Generated with'))
    .join('\n')
    .trim();
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined,
  { year: 'numeric', month: 'long', day: 'numeric' });

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

function commitHTML(c) {
  const msg = cleanMessage(c.commit.message);
  const [title, ...rest] = msg.split('\n\n');
  // Commit bodies are hard-wrapped at ~72 chars by convention. Unwrap those
  // single newlines into spaces (blank lines stay paragraph breaks, and lines
  // starting like list items keep their breaks) so sentences flow naturally.
  const body = rest.join('\n\n').trim();
  const paragraphs = body
    ? body.split(/\n{2,}/).map((p) =>
        `<p class="log-commit-body">${esc(p.replace(/\n(?![-*•\d])/g, ' '))}</p>`).join('')
    : '';
  return `
  <article class="log-commit">
    <h3>${esc(title)}</h3>
    ${paragraphs}
    <span class="log-sha">${esc(c.sha.slice(0, 7))} · ${esc(fmtDate(c.commit.author.date))}</span>
  </article>`;
}

async function render() {
  const status = document.getElementById('logStatus');
  try {
    const [tags, commits] = await Promise.all([
      getJSON(`${API}/tags?per_page=100`),
      getJSON(`${API}/commits?per_page=100`),
    ]);
    const tagBySha = Object.fromEntries(tags.map((t) => [t.commit.sha, t.name]));

    // Commits arrive newest-first. A tag opens a version section that owns
    // every commit down to (not including) the next older tag.
    let html = '';
    let openSection = null;   // commits html accumulating under current version
    let heading = null;
    const flush = () => {
      if (openSection === null) return;
      html += heading + openSection;
      openSection = null;
    };
    for (const c of commits) {
      const tag = tagBySha[c.sha];
      if (tag) {
        flush();
        heading = `
        <div class="log-version">
          <h2>${esc(tag)}</h2>
          <span class="log-date">${esc(fmtDate(c.commit.author.date))}</span>
        </div>`;
        openSection = '';
      }
      if (openSection === null) {
        // Commits newer than the newest tag (shouldn't happen if HEAD is
        // always tagged on release, but don't hide work if it does).
        heading = `
        <div class="log-version">
          <h2>next</h2>
          <span class="log-date">not yet released</span>
        </div>`;
        openSection = '';
      }
      openSection += commitHTML(c);
    }
    flush();

    status.remove();
    document.getElementById('log').insertAdjacentHTML('beforeend', html);
  } catch (err) {
    status.textContent = 'couldn’t reach GitHub just now — the full history lives at ';
    status.classList.add('err');
    const a = document.createElement('a');
    a.href = `https://github.com/${REPO}/commits/main`;
    a.textContent = `github.com/${REPO}`;
    status.appendChild(a);
  }
}

render();
