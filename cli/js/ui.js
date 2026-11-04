// Terminal UI: transcript, spinner, token-style streaming, slash-command
// palette (ARIA combobox), input history, suggestion bar, announcements.
// Knows nothing about the CV: app.js passes in `onRun` and `complete`.

import { esc, toFragment, pick } from './util.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const VERBS = [
  'Grepping cv.md', 'Tokenizing', 'Ranking chunks', 'Cross-referencing', 'Reading between the bullet points',
  'Consulting the markdown', 'Not hallucinating', 'Indexing', 'Checking the facts', 'Skimming the timeline',
];
const HISTORY_KEY = 'cliHistory';

export function createUI({ motion, coarse, onRun, complete }) {
  const $ = (id) => document.getElementById(id);
  const term = $('term');
  const log = $('log');
  const form = $('promptForm');
  const input = $('prompt');
  const palette = $('palette');
  const suggestBar = $('suggest');
  const announcer = $('announcer');

  // Anything animating registers a "finish now" callback here. Esc, a click
  // during boot, or a new command flushes them all.
  const skipFns = new Set();
  let pending = 0; // commands queued behind the one being rendered
  const animate = () => motion && pending === 0;

  function skipAll() {
    const fns = [...skipFns];
    skipFns.clear();
    fns.forEach((f) => f());
  }

  // ---- output ---------------------------------------------------------------
  function block(markup = '', cls = '') {
    const el = document.createElement('div');
    el.className = `blk ${cls}`.trim();
    el.append(toFragment(markup));
    log.append(el);
    follow(el);
    return el;
  }

  function exchange(text) {
    const ex = document.createElement('article');
    ex.className = 'ex';
    ex.setAttribute('aria-label', `You asked: ${text}`);
    const u = document.createElement('div');
    u.className = 'msg msg--user';
    u.innerHTML = '<span class="msg__glyph" aria-hidden="true">›</span>';
    const t = document.createElement('span');
    t.className = 'msg__text';
    t.textContent = text; // visitor input: never parsed as HTML
    u.append(t);
    ex.append(u);
    log.append(ex);
    follow(ex);
    return ex;
  }

  /** Keep the newest exchange in view without scrolling its first line away. */
  function follow(el) {
    const top = el.offsetTop - 12;
    const bottom = term.scrollHeight - term.clientHeight;
    term.scrollTop = Math.max(0, Math.min(bottom, top));
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      if (!animate()) return resolve(true);
      let done = false;
      const finish = (skipped) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        skipFns.delete(onSkip);
        resolve(skipped);
      };
      const onSkip = () => finish(true);
      const timer = setTimeout(() => finish(false), ms);
      skipFns.add(onSkip);
    });
  }

  function think(ex, ms) {
    if (!animate()) return Promise.resolve();
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'spin';
      el.setAttribute('aria-hidden', 'true');
      ex.append(el);
      const verb = pick(VERBS);
      const t0 = performance.now();
      let i = 0;
      const tick = () => {
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        el.textContent = `${FRAMES[i++ % FRAMES.length]} ${verb}… ${secs}s${coarse ? '' : ' · esc to skip'}`;
      };
      tick();
      const iv = setInterval(tick, 80);
      follow(ex);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(iv);
        clearTimeout(timer);
        skipFns.delete(finish);
        el.remove();
        resolve();
      };
      const timer = setTimeout(finish, ms);
      skipFns.add(finish);
    });
  }

  /**
   * Append an output message to an exchange. `stream` reveals the text like
   * tokens arriving; the visual copy is aria-hidden while it streams and the
   * full text is announced once through the polite live region instead.
   */
  async function render(ex, { html, trace, kind = 'cmd', stream = false }) {
    const out = document.createElement('div');
    out.className = `msg msg--out msg--${kind}`;
    if (trace) {
      const tr = document.createElement('div');
      tr.className = 'trace';
      tr.textContent = trace;
      out.append(tr);
    }
    const body = document.createElement('div');
    body.className = 'msg__body';
    body.append(toFragment(html));
    out.append(body);
    ex.append(out);
    if (stream && animate()) await streamText(body, ex);
    else {
      if (animate()) out.classList.add('is-fresh');
      follow(ex);
    }
    return out;
  }

  function streamText(container, ex) {
    return new Promise((resolve) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const items = [];
      let n;
      while ((n = walker.nextNode())) {
        items.push([n, n.data]);
        n.data = '';
      }
      const total = items.reduce((a, [, t]) => a + t.length, 0);
      const perFrame = Math.max(4, Math.ceil(total / 50)); // never more than ~0.8 s
      container.classList.add('is-streaming');
      container.setAttribute('aria-hidden', 'true');
      let i = 0;
      let pos = 0;
      let raf = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        skipFns.delete(finish);
        items.forEach(([node, text]) => (node.data = text));
        container.classList.remove('is-streaming');
        container.removeAttribute('aria-hidden');
        follow(ex);
        resolve();
      };
      const frame = () => {
        let budget = perFrame;
        while (budget > 0 && i < items.length) {
          const [node, text] = items[i];
          const take = Math.min(budget, text.length - pos);
          pos += take;
          budget -= take;
          node.data = text.slice(0, pos);
          if (pos >= text.length) {
            i++;
            pos = 0;
          }
        }
        follow(ex);
        if (i >= items.length) finish();
        else raf = requestAnimationFrame(frame);
      };
      skipFns.add(finish);
      raf = requestAnimationFrame(frame);
    });
  }

  function clear() {
    skipAll();
    log.replaceChildren();
    term.scrollTop = 0;
  }

  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => {
      announcer.textContent = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    });
  }

  // ---- suggestion bar -------------------------------------------------------------
  function setSuggestions(list) {
    suggestBar.replaceChildren(
      ...[...new Set(list)].slice(0, 6).map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `sugg ${s.startsWith('/') ? 'sugg--cmd' : 'sugg--ask'}`;
        b.dataset.run = s;
        b.textContent = s;
        return b;
      }),
    );
    suggestBar.scrollLeft = 0;
  }

  // ---- history (per tab session) -------------------------------------------
  let history = [];
  try {
    history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    history = [];
  }
  let hIndex = history.length;
  let draft = '';

  function pushHistory(v) {
    if (history[history.length - 1] !== v) history.push(v);
    if (history.length > 50) history = history.slice(-50);
    hIndex = history.length;
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* private mode: history just won't survive a reload */
    }
  }

  function recall(dir) {
    if (!history.length) return;
    if (dir < 0) {
      if (hIndex === history.length) draft = input.value;
      hIndex = Math.max(0, hIndex - 1);
      input.value = history[hIndex];
    } else {
      if (hIndex >= history.length) return;
      hIndex += 1;
      input.value = hIndex === history.length ? draft : history[hIndex];
    }
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
  }

  // ---- readiness ---------------------------------------------------------------
  // Nothing runs until app.js has loaded the CV and calls setReady(). An Enter
  // pressed before that keeps the typed text and is replayed once ready.
  let ready = false;
  let pendingSubmit = false;

  function setReady() {
    ready = true;
    if (pendingSubmit && input.value.trim()) submit(input.value);
    pendingSubmit = false;
  }

  function fail(message) {
    ready = false;
    pendingSubmit = false;
    input.disabled = true;
    input.placeholder = message;
    closePalette();
  }

  // ---- slash palette (combobox) -----------------------------------------------
  let items = [];
  let active = 0;
  let navigated = false; // selection moved with the arrow keys

  function openPalette() {
    const v = input.value;
    items = v.startsWith('/') ? complete(v) : [];
    if (!items.length) return closePalette();
    active = Math.min(active, items.length - 1);
    palette.innerHTML = items
      .map(
        (it, i) =>
          `<li role="option" id="pal-${i}" class="pal__item${i === active ? ' is-active' : ''}" aria-selected="${i === active}" data-i="${i}"><span class="pal__cmd">${esc(it.label)}</span><span class="pal__hint">${esc(it.hint || '')}</span><span class="pal__desc">${esc(it.desc || '')}</span></li>`,
      )
      .join('');
    palette.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `pal-${active}`);
  }

  function closePalette() {
    items = [];
    active = 0;
    palette.hidden = true;
    palette.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function move(d) {
    navigated = true;
    active = (active + d + items.length) % items.length;
    palette.querySelectorAll('.pal__item').forEach((li, i) => {
      li.classList.toggle('is-active', i === active);
      li.setAttribute('aria-selected', String(i === active));
    });
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    palette.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function accept() {
    const it = items[active];
    if (!it) return;
    input.value = it.takesArgs ? `${it.value} ` : it.value;
    active = 0;
    openPalette();
    if (!it.takesArgs) closePalette();
  }

  // ---- submit -------------------------------------------------------------------
  function submit(value) {
    const v = value.trim();
    if (!v) return;
    if (!ready) {
      pendingSubmit = true; // keep the text; replayed by setReady()
      return;
    }
    pushHistory(v);
    input.value = '';
    draft = '';
    closePalette();
    if (coarse) input.blur(); // drop the on-screen keyboard so the answer is visible
    onRun(v, 'typed');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value);
  });

  input.addEventListener('input', () => {
    active = 0;
    navigated = false;
    openPalette();
  });

  input.addEventListener('keydown', (e) => {
    const open = !palette.hidden && items.length;
    if (e.key === 'Enter' && open && !e.isComposing) {
      e.preventDefault();
      // The highlighted entry wins only if it really matches what was typed,
      // or was picked with the arrows: a description-only match must not turn
      // "/experience amadeus" into "/experience 1".
      const it = items[active];
      submit(navigated || it.strong ? it.value : input.value);
    } else if (e.key === 'Tab' && open) {
      e.preventDefault();
      accept();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) move(1);
      else recall(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) move(-1);
      else recall(-1);
    } else if (e.key === 'Escape') {
      if (open) closePalette();
      else skipAll();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (ready) onRun('/clear', 'key');
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString() && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      if (input.value) {
        const ex = exchange(`${input.value}^C`);
        ex.classList.add('ex--cancelled');
      }
      input.value = '';
      closePalette();
    }
  });

  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== input) closePalette();
  }, 120));

  palette.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  palette.addEventListener('click', (e) => {
    const li = e.target.closest('.pal__item');
    if (!li) return;
    active = +li.dataset.i;
    const it = items[active];
    if (it?.takesArgs && input.value.trim() !== it.value) accept();
    else if (it) submit(it.value);
    input.focus();
  });

  // Clickable output + suggestions.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-run]');
    if (!btn || btn.closest('#palette')) {
      if (!btn) skipAll();
      return;
    }
    e.preventDefault();
    if (!ready) return;
    onRun(btn.dataset.run, 'click');
    if (!coarse) input.focus({ preventScroll: true });
  });

  // Clicking empty transcript space focuses the prompt (unless selecting text).
  term.addEventListener('mouseup', (e) => {
    if (coarse || e.target.closest('a, button, input, [data-run]')) return;
    if (!window.getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  // The skip link focuses the prompt without touching the hash: the hash is
  // the deep-link command, so "#prompt" would be run as a question.
  document.querySelector('.skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    input.focus();
  });

  // Typing anywhere goes to the prompt; Esc anywhere skips animations.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') skipAll();
    if (document.activeElement === input) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    // Space on a focused control keeps its native activation (buttons fire on keyup).
    if (e.key === ' ' && e.target.closest?.('a, button, summary, [role="button"], [tabindex]')) return;
    if (skipFns.size) skipAll();
    input.focus({ preventScroll: true });
  });

  // Rotating placeholder with example questions.
  function rotatePlaceholder(examples) {
    let i = 0;
    const set = () => {
      if (window.innerWidth < 640) {
        input.placeholder = 'Ask a question, or type /';
        return;
      }
      input.placeholder = i % 2 === 0 ? `Ask anything, e.g. “${examples[(i / 2) % examples.length]}”` : 'Type / for commands, or just ask a question';
      i = (i + 1) % (examples.length * 2);
    };
    set();
    setInterval(() => {
      if (!input.value) set();
    }, 5000);
  }

  return {
    block,
    exchange,
    render,
    think,
    sleep,
    clear,
    announce,
    setSuggestions,
    skipAll,
    follow,
    rotatePlaceholder,
    setReady,
    fail,
    focus: () => !coarse && input.focus({ preventScroll: true }),
    queue: {
      add: () => {
        pending++;
        skipAll();
      },
      done: () => {
        pending = Math.max(0, pending - 1);
      },
    },
  };
}
