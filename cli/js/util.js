// Small, dependency-free helpers shared by the CLI modules.

// ---------------------------------------------------------------------------
// HTML templating: interpolations are escaped unless wrapped in raw().
// Everything typed by the visitor goes through esc(); only cv.md-derived
// markup (trusted, it's the site owner's own file) is passed through raw().
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => (s instanceof SafeHtml ? s : new SafeHtml(String(s ?? '')));

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

function toHtml(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(v);
}

export function toFragment(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup);
  return t.content;
}

/** Inline clickable command: runs `cmd` as if typed. */
export const run = (cmd, label = cmd, cls = '') =>
  html`<button type="button" class="run ${cls}" data-run="${cmd}">${label}</button>`;

/** External link, always new tab. */
export const ext = (href, label = href) =>
  html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function slug(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Canonical form for matching: lowercase, no accents, a few tech spellings
 * unified (C++ -> cpp, Node.js -> nodejs, front-end -> frontend…), then
 * collapsed to space-separated alphanumeric words.
 */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/c\+\+/g, ' cpp ')
    .replace(/c#/g, ' csharp ')
    .replace(/\.net\b/g, ' dotnet ')
    .replace(/\bnode\.?js\b/g, ' nodejs ')
    .replace(/\bci\s*\/\s*cd\b/g, ' cicd ')
    .replace(/\bpl\s*\/\s*sql\b/g, ' plsql ')
    .replace(/\bfront[\s-]?end\b/g, ' frontend ')
    .replace(/\bback[\s-]?end\b/g, ' backend ')
    .replace(/\bgen[\s-]?ai\b/g, ' genai ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whole-word phrase containment on norm()'d strings. */
export function hasPhrase(hay, needle) {
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

/** Leading emoji / symbols ("🧠 ", "🇮🇹 ") split from the label. */
export function splitIcon(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/^[^\p{L}\p{N}(“"']+/u);
  const icon = m ? m[0].trim() : '';
  return { icon, label: t.slice(m ? m[0].length : 0).trim() };
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
// Dates: "Nov 2024 – Present", "Sep 2016 – May 2019", "2010–2011", "(2017)"
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_CAP = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

const monthOf = (s) => (s ? MONTHS.indexOf(s.slice(0, 3).toLowerCase()) : -1);

export function parseRange(text) {
  const re =
    /(?:([A-Za-z]{3,9})\.?\s+)?((?:19|20)\d{2})\s*[–—-]\s*(?:(present|current|now|today|ongoing)|(?:([A-Za-z]{3,9})\.?\s+)?((?:19|20)\d{2}))/i;
  const m = String(text ?? '').match(re);
  if (m) {
    const sm = monthOf(m[1]);
    const start = { y: +m[2], m: sm >= 0 ? sm : 0 };
    if (m[3]) return { start, end: null, current: true };
    const em = monthOf(m[4]);
    return { start, end: { y: +m[5], m: em >= 0 ? em : 11 }, current: false };
  }
  const single = String(text ?? '').match(/\(((?:19|20)\d{2})\)/);
  if (single) return { start: { y: +single[1], m: 0 }, end: { y: +single[1], m: 11 }, current: false };
  return null;
}

const ym = (d) => d.y * 12 + d.m;

export function today() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
}

/** Inclusive month count, LinkedIn-style (Jan–Nov of one year = 11 months). */
export function months(range) {
  if (!range) return 0;
  return ym(range.end || today()) - ym(range.start) + 1;
}

export function fmtDuration(n) {
  const y = Math.floor(n / 12);
  const m = n % 12;
  const parts = [];
  if (y) parts.push(`${y} yr${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} mo${m > 1 ? 's' : ''}`);
  return parts.join(' ') || '< 1 mo';
}

export const fmtYM = (d) => `${MONTHS_CAP[d.m]} ${d.y}`;
