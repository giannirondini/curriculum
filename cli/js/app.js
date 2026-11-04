// CLI bootstrap.
//
//   theme (before anything paints)
//   fetch ../cv.md -> buildModel -> facts / views / BM25 index / commands / answerer
//   boot log (first visit per tab, motion only) -> neofetch banner
//   replay the URL hash as a command (deep link), then wait for input
//
// Input routing: "/cmd args" -> commands.js · a bare command word ("help",
// "skills") -> same · a few shell-isms (ls, whoami, git log…) -> eggs or
// aliases · anything else -> answer.js (offline Q&A over the CV).

import { buildModel, statedYears, careerStart, currentJob } from './model.js';
import { createFacts } from './facts.js';
import { createViews } from './views.js';
import { createCommands } from './commands.js';
import { createAnswerer } from './answer.js';
import { buildDocs, Bm25 } from './search.js';
import { loadPortrait, renderPortrait } from './ascii.js';
import { createUI } from './ui.js';
import { html, run, ext, fmtYM, plural } from './util.js';

const CV_URL = '../cv.md';
const PDF_URL = '../pdf/Gianni-Rondini-CV.pdf';
const PHOTO_URL = '../assets/me.jpg';
const CLASSIC_URL = '../';
const VERSION = '1.0.0';

const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
const root = document.documentElement;
const repoUrl = document.getElementById('app')?.dataset.repo || '';

let portrait = null;
initTheme();
main();

// ---------------------------------------------------------------------------

function storage(kind) {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = storage('localStorage')?.getItem('cvTheme');
  } catch {
    saved = null;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  document.getElementById('themeToggle')?.addEventListener('click', () => setTheme(null));
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  if (portrait) {
    document.querySelectorAll('.nf__art').forEach((el) => (el.textContent = renderPortrait(portrait, theme)));
  }
}

/** Shared with the classic site through localStorage.cvTheme. */
function setTheme(theme) {
  const next = theme || (root.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme(next);
  try {
    storage('localStorage')?.setItem('cvTheme', next);
  } catch {
    /* not persisted, still applied */
  }
  return next;
}

// ---- deep links: cli/#/skills+ai · cli/#what+is+mcp ----------------------------
function readHash() {
  const h = location.hash.slice(1);
  if (!h) return '';
  try {
    return decodeURIComponent(h.replace(/\+/g, ' ')).trim();
  } catch {
    return '';
  }
}

function writeHash(value) {
  const enc = value
    ? `#${encodeURIComponent(value).replace(/%20/g, '+').replace(/%2F/gi, '/').replace(/%3F/gi, '?')}`
    : location.pathname + location.search;
  history.replaceState(null, '', enc);
}

// ---------------------------------------------------------------------------

async function main() {
  let commands = null;
  let answerer = null;
  let model = null;
  let index = null;
  let starters = ['/help'];
  const stats = { questions: 0 };
  let lastRun = '';

  const ui = createUI({
    motion,
    coarse,
    onRun: (value) => execute(value),
    complete: (value) => (commands ? commands.complete(value) : []),
  });

  const t0 = performance.now();
  let md = '';
  try {
    if (typeof window.marked === 'undefined') throw new Error('markdown parser failed to load');
    const res = await fetch(CV_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`cv.md answered ${res.status}`);
    md = await res.text();
  } catch (e) {
    ui.block(
      html`<p class="o-p"><span class="o-err">✗</span> Could not load the CV: ${e.message}.</p>
        <p class="o-p">The classic version may still work: <a href="${CLASSIC_URL}">open it</a>.</p>`,
      'blk--error',
    );
    document.getElementById('term')?.removeAttribute('aria-busy');
    console.error(e);
    return;
  }

  model = buildModel(md, window.marked);
  const facts = createFacts(model);
  const views = createViews(model, facts);
  index = new Bm25(buildDocs(model));
  answerer = createAnswerer({ model, facts, views, index, repoUrl });
  const readyMs = performance.now() - t0;
  const first = model.name.split(' ')[0];

  const actions = {
    pdfUrl: PDF_URL,
    downloadPdf() {
      const a = document.createElement('a');
      a.href = PDF_URL;
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    },
    setTheme,
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      ui.clear();
      writeHash('');
      lastRun = '';
      return null;
    },
    goClassic() {
      location.href = CLASSIC_URL;
    },
    stats: () => ({ ...stats, docs: index.docs.length, vocabulary: index.vocabulary, motion }),
    banner: () => banner(),
  };

  commands = createCommands({ model, facts, views, actions, examples: answerer.examples });
  starters = ['/help', '/about', '/experience', '/skills', '/projects', `What is ${first} working on now?`];

  // ---- banner ----------------------------------------------------------------
  function banner() {
    const j = currentJob(model);
    const start = careerStart(model);
    const skillCount = model.skills.reduce((a, c) => a + c.skills.length, 0);
    const email = model.contacts.find((c) => c.kind === 'email');
    const gh = model.contacts.find((c) => c.kind === 'github');
    const rows = [
      ['role', model.roles.slice(0, 2).join(' · ')],
      ['focus', model.roles.slice(2).join(' · ')],
      ['now', j ? `${j.company}${j.team ? ` · ${j.team}` : ''}${j.range?.current ? ` (since ${fmtYM(j.range.start)})` : ''}` : ''],
      ['uptime', [statedYears(model), start ? `since ${fmtYM(start)}` : ''].filter(Boolean).join(' · ')],
      ['skills', model.skills.length ? `${skillCount} across ${plural(model.skills.length, 'category', 'categories')}` : ''],
      ['speaks', model.languages.map((l) => l.label).join(' · ')],
      ['contact', email ? html`<a href="${email.href}">${email.label}</a>` : ''],
      ['github', gh ? ext(gh.href, gh.label) : ''],
    ].filter(([, v]) => v);
    const host = `${first.toLowerCase()}@cv`;
    const art = portrait ? renderPortrait(portrait, root.dataset.theme) : '';
    return html`<div class="nf">
        <div class="nf__box">
          <span class="nf__legend">${first.toLowerCase()}-cli v${VERSION} · offline CV agent</span>
          ${art ? html`<pre class="nf__art" role="img" aria-label="ASCII-art portrait of ${model.name}">${art}</pre>` : ''}
          <div class="nf__info">
            <div class="nf__host"><span class="o-accent">guest</span>@<span class="o-accent2">${host.split('@')[0]}</span></div>
            <div class="nf__rule" aria-hidden="true">${'─'.repeat(Math.max(12, host.length + 6))}</div>
            <dl class="nf__kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
            <div class="nf__colors" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => html`<span class="c${i}"></span>`)}</div>
          </div>
        </div>
        <p class="nf__hello">Ask anything about ${first}'s career, or type <kbd>/</kbd> for commands.</p>
        <p class="o-tip">Try ${run('/help')} · ${run('/experience')} · ${run(`/skills ${model.skills[0]?.key || ''}`.trim())} · ${run(answerer.examples()[0], `“${answerer.examples()[0]}”`)}</p>
      </div>`;
  }

  // ---- boot log --------------------------------------------------------------
  async function boot() {
    const bullets = model.jobs.reduce((a, j) => a + j.bullets.length, 0);
    const skillCount = model.skills.reduce((a, c) => a + c.skills.length, 0);
    const line = (status, label, detail) =>
      html`<div class="boot__line"><span class="boot__st boot__st--${status.trim()}">[${status}]</span> ${label.padEnd(17, '·')} <span class="o-muted">${detail}</span></div>`;
    const lines = [
      html`<div class="boot__line boot__head">${first.toLowerCase()}-cli v${VERSION} · booting</div>`,
      line(' ok ', 'fetch cv.md ', `${(model.stats.bytes / 1024).toFixed(1)} kB · ${model.stats.lines} lines`),
      line(' ok ', 'parse markdown ', `${plural(model.sections.length, 'section')}${model.warnings.length ? ` · ${plural(model.warnings.length, 'fallback')}` : ''}`),
      line(' ok ', 'load experience ', `${plural(model.jobs.length, 'role')} · ${plural(bullets, 'bullet')}`),
      line(' ok ', 'load skills ', `${skillCount} skills · ${plural(model.skills.length, 'category', 'categories')}`),
      line(' ok ', 'build index ', `${index.docs.length} chunks · ${index.vocabulary} terms`),
      line('skip', 'load LLM ', 'not needed'),
      line(' ok ', 'ready ', `${Math.max(1, Math.round(readyMs))} ms`),
    ];
    const box = ui.block('', 'boot');
    box.setAttribute('aria-hidden', 'true');
    let fast = false;
    for (const l of lines) {
      box.insertAdjacentHTML('beforeend', String(l));
      ui.follow(box);
      if (!fast) fast = await ui.sleep(85);
    }
    await ui.sleep(fast ? 0 : 160);
  }

  // ---- input routing -----------------------------------------------------------
  const SHELL = [
    [/^ls(\s.*)?$/, () => '/help'],
    [/^(whoami|id)$/, () => '/about'],
    [/^git (log|shortlog|blame)(\s.*)?$/, () => '/experience'],
    [/^(man|info)(\s.*)?$/, () => '/help'],
    [/^cat(\s.*)?$/, () => '/tldr'],
    [/^(neofetch|fastfetch|screenfetch)$/, () => '/neofetch'],
    [/^sudo(\s.*)?$/, (m) => `/sudo ${m[1] || ''}`.trim()],
    [/^(exit|quit|logout)$/, () => '/exit'],
    [/^(vi|vim|nvim|emacs|nano)(\s.*)?$/, () => '/vim'],
    [/^pwd$/, () => html`<p class="o-p">~/${first.toLowerCase()}/cv</p>`],
    [/^cd(\s.*)?$/, () => html`<p class="o-p">No directories here, only questions. Try ${run('/help')}.</p>`],
    [/^rm\s+-\w*r\w*\b.*$/, () => html`<p class="o-p"><span class="o-err">rm:</span> cannot remove: this CV is read-only (and version-controlled).</p>`],
    [/^:(q|q!|wq|x)$/, () => html`<p class="o-p">Not in vim. But nice reflexes.</p>`],
    [/^(npm|pnpm|yarn|pip|brew|apt|apt-get|cargo)\s+(i|install|add)\b.*$/, () => html`<p class="o-p">Installing… just kidding. The only dependency here is a markdown parser.</p>`],
    [/^date$/, () => html`<p class="o-p">${new Date().toString()}</p>`],
    [/^history$/, () => {
      let h = [];
      try {
        h = JSON.parse(storage('sessionStorage')?.getItem('cliHistory') || '[]');
      } catch {
        h = [];
      }
      return h.length
        ? html`<ol class="o-list o-list--num">${h.slice(-15).map((x) => html`<li>${run(x)}</li>`)}</ol>`
        : html`<p class="o-p o-muted">No history yet.</p>`;
    }],
  ];

  function resolveInput(input) {
    if (input.startsWith('/')) return { cmd: input };
    const echo = input.match(/^echo\s+(.+)$/is); // keep the visitor's casing
    if (echo) return { html: html`<p class="o-p">${echo[1]}</p>` };
    const lower = input.toLowerCase().replace(/[?!.\s]+$/, '');
    if (!lower) return { cmd: '/help' }; // a lone "?"
    for (const [re, fn] of SHELL) {
      const m = lower.match(re);
      if (!m) continue;
      const out = fn(m);
      return typeof out === 'string' ? { cmd: out } : { html: out };
    }
    const bare = commands.find(lower);
    if (bare && bare.bare !== false && /^[\w-]+$/.test(lower)) return { cmd: `/${lower}` };
    return { question: input };
  }

  let chain = Promise.resolve();
  function execute(value) {
    ui.queue.add();
    chain = chain
      .then(() => {
        ui.queue.done();
        return doExecute(value);
      })
      .catch((e) => {
        console.error(e);
        ui.block(html`<p class="o-p"><span class="o-err">✗</span> Something broke while answering: ${e.message}</p>`);
      });
    return chain;
  }

  async function doExecute(value) {
    const input = value.trim();
    if (!input) return;
    lastRun = input;
    const route = resolveInput(input);
    const ex = ui.exchange(input);
    let result = null;
    let out = null;

    if (route.html) {
      out = await ui.render(ex, { html: route.html });
      result = { deeplink: false };
    } else if (route.cmd) {
      result = await commands.exec(route.cmd);
      if (result?.html) out = await ui.render(ex, { html: result.html });
      else if (ex.isConnected && route.cmd.startsWith('/clear')) ex.remove();
    } else {
      stats.questions += 1;
      const r = answerer.answer(route.question);
      await ui.think(ex, 380 + Math.random() * 420);
      out = await ui.render(ex, {
        html: r.html,
        kind: 'agent',
        trace: `▸ ${r.intent} · ${r.detail} · ${r.ms.toFixed(1)} ms`,
        stream: true,
      });
      result = { ...r, deeplink: true };
    }

    if (result?.deeplink !== false) writeHash(input);
    ui.setSuggestions(result?.suggest?.length ? result.suggest : starters);
    if (out) ui.announce(out.querySelector('.msg__body')?.textContent || '');
  }

  // ---- start -------------------------------------------------------------------
  const portraitReady = loadPortrait(PHOTO_URL)
    .then((p) => (portrait = p))
    .catch(() => null);

  const sess = storage('sessionStorage');
  let booted = false;
  try {
    booted = sess?.getItem('cliBooted') === '1';
    sess?.setItem('cliBooted', '1');
  } catch {
    booted = false;
  }
  if (motion && !booted) await boot();
  await portraitReady;

  ui.block(banner(), 'blk--banner');
  document.getElementById('term')?.removeAttribute('aria-busy');
  ui.setSuggestions(starters);
  ui.rotatePlaceholder(answerer.examples());
  ui.announce(`${model.name} — CV terminal ready. Ask a question or type slash help.`);

  const initial = readHash();
  if (initial) await execute(initial);
  ui.focus();

  window.addEventListener('hashchange', () => {
    const v = readHash();
    if (v && v !== lastRun) execute(v);
  });
}
