// Slash-command registry. Section commands are generated from cv.md, so a
// new `## Section` in the markdown becomes a new `/command` automatically.

import { html, raw, run, ext, plural, norm, hasPhrase, levenshtein, fmtYM } from './util.js';
import { statedYears, currentJob } from './model.js';

export function createCommands(ctx) {
  const { model, facts, views, actions } = ctx;
  const list = [];
  const def = (name, opts) =>
    list.push({ name, aliases: [], hidden: false, group: 'cv', deeplink: true, args: '', ...opts });
  const err = (msg, suggest = ['/help']) => ({ html: html`<p class="o-p"><span class="o-err">✗</span> ${msg}</p>`, suggest });
  const first = model.name.split(' ')[0];

  // ---- CV ---------------------------------------------------------------
  def('about', { desc: 'Professional summary', aliases: ['whoami', 'summary', 'bio'], exec: () => views.about() });

  def('experience', {
    desc: 'Roles, newest first',
    aliases: ['exp', 'jobs', 'work', 'career'],
    args: '[n | company | year]',
    complete: () => [
      ...model.jobs.map((j) => ({ value: `/experience ${j.n}`, label: String(j.n), desc: `${j.title} · ${j.company}` })),
      ...facts.companies.map((c) => ({ value: `/experience ${c}`, label: c, desc: 'roles at this company' })),
    ],
    exec(arg) {
      if (!arg) return views.experience();
      if (/^\d{1,2}$/.test(arg)) {
        const j = model.jobs[+arg - 1];
        return j ? views.job(j) : err(`There's no role #${arg}; the CV lists ${plural(model.jobs.length, 'role')}.`, ['/experience']);
      }
      if (/^(19|20)\d{2}$/.test(arg)) return views.inYear(+arg);
      const q = norm(arg);
      const atCompany = facts.jobsAt(q.split(' ')[0]);
      if (atCompany.length) return views.experience(atCompany, `Roles at ${atCompany[0].company}`);
      const matches = model.jobs.filter((j) => hasPhrase(norm(j.text), q));
      if (matches.length === 1) return views.job(matches[0]);
      if (matches.length) return views.experience(matches, `Roles mentioning “${arg}”`);
      return err(html`Nothing in the experience section matches “${arg}”. Try ${run('/experience')}.`, ['/experience']);
    },
  });

  def('skills', {
    desc: 'Core competencies, and where each one was used',
    aliases: ['skill', 'stack', 'tech'],
    args: '[category | skill]',
    complete: () => model.skills.map((c) => ({ value: `/skills ${c.key}`, label: c.key, desc: c.name })),
    exec(arg) {
      if (!arg) return views.skills();
      const q = norm(arg);
      const cat = facts.categoryByKey(arg);
      const exactCat = cat && (cat.key === arg.toLowerCase() || cat.words.includes(q) || norm(cat.name) === q);
      if (exactCat) return views.category(cat);
      const res = facts.lookup(q);
      if (res.found) return views.skill(res);
      if (cat) return views.category(cat);
      return views.notInCv(arg, facts.related(q), facts.closest(q));
    },
  });

  def('projects', {
    desc: 'Open source & side projects',
    aliases: ['project', 'oss', 'repos', 'portfolio'],
    args: '[name]',
    complete: () => model.projects.map((p) => ({ value: `/projects ${p.slug}`, label: p.slug, desc: p.tech.join(' · ') })),
    exec(arg) {
      if (!arg) return views.projects();
      const p = facts.project(arg);
      return p ? views.project(p) : err(html`No project called “${arg}”. ${run('/projects')} lists them all.`, ['/projects']);
    },
  });

  def('mcp', { desc: `MCP servers ${first} has built`, exec: () => views.mcp() });

  // Remaining sections, in cv.md order (education, certifications, …, plus any
  // new section added to the markdown later).
  const sectionViews = {
    education: [views.education, 'Degrees', ['edu', 'studies']],
    certifications: [views.certifications, 'Certifications', ['certs', 'certificates']],
    languages: [views.languages, 'Spoken languages', ['langs', 'speak']],
    publications: [views.publications, 'Research & publications', ['papers', 'pubs']],
  };
  const builtIn = new Set(['about', 'experience', 'skills', 'projects']);
  model.sections.forEach((s) => {
    if (builtIn.has(s.command)) return;
    const [view, desc, aliases] = sectionViews[s.command] || [() => views.generic(s), s.title, []];
    def(s.command, { desc, aliases, exec: () => view() });
  });

  def('contact', { desc: `How to reach ${first}`, aliases: ['email', 'reach'], exec: () => views.contact() });

  def('tldr', {
    desc: 'The whole CV in five lines',
    aliases: ['compact'],
    exec() {
      const j = currentJob(model);
      const counts = new Map();
      model.jobs.forEach((x) => x.stack.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s);
      const email = model.contacts.find((c) => c.kind === 'email');
      return {
        html: html`<dl class="o-kv o-kv--tight">
          <dt>who</dt><dd><strong>${model.name}</strong> — ${model.tagline}</dd>
          ${j ? html`<dt>now</dt><dd>${j.title} @ ${j.company}${j.range?.current ? ` (since ${fmtYM(j.range.start)})` : ''}</dd>` : ''}
          ${statedYears(model) ? html`<dt>uptime</dt><dd>${statedYears(model)}</dd>` : ''}
          ${model.summary?.highlights.length ? html`<dt>focus</dt><dd>${model.summary.highlights.map((h) => h.title).join(' · ')}</dd>` : ''}
          ${top.length ? html`<dt>stack</dt><dd>${top.join(' · ')} <span class="o-muted">(most frequent across roles)</span></dd>` : ''}
          ${email ? html`<dt>contact</dt><dd><a href="${email.href}">${email.label}</a></dd>` : ''}
        </dl>`,
        suggest: ['/about', '/experience', '/contact'],
      };
    },
  });

  // ---- Session --------------------------------------------------------------
  def('help', { desc: 'This list', aliases: ['h', '?', 'commands', 'man'], group: 'session', exec: () => help() });
  def('pdf', {
    desc: 'Download the PDF CV',
    aliases: ['download'],
    group: 'session',
    deeplink: false,
    bare: false,
    exec() {
      actions.downloadPdf();
      return {
        html: html`<p class="o-p"><span class="o-ok">↓</span> Downloading ${ext(actions.pdfUrl, actions.pdfUrl.split('/').pop())}…</p>`,
        suggest: ['/contact', '/classic'],
      };
    },
  });
  def('theme', {
    bare: false,
    desc: 'Switch light / dark',
    args: '[light | dark]',
    group: 'session',
    deeplink: false,
    complete: () => ['light', 'dark'].map((t) => ({ value: `/theme ${t}`, label: t, desc: `${t} theme` })),
    exec(arg) {
      const t = ['light', 'dark'].includes(arg) ? arg : null;
      if (arg && !t) return err(html`Unknown theme “${arg}”. Use ${run('/theme light')} or ${run('/theme dark')}.`);
      const applied = actions.setTheme(t);
      return { html: html`<p class="o-p">Theme set to <strong>${applied}</strong>. Saved for the classic site too.</p>` };
    },
  });
  def('share', {
    bare: false,
    desc: 'Copy a link to the last answer',
    aliases: ['link', 'permalink'],
    group: 'session',
    deeplink: false,
    async exec() {
      const url = location.href;
      const copied = await actions.copy(url);
      return {
        html: html`<p class="o-p">${copied ? html`<span class="o-ok">✓</span> Copied:` : 'Copy this link:'} <code class="o-code">${url}</code></p>
          <p class="o-tip">Any command or question works as a link: <code>cli/#/skills ai</code>, <code>cli/#what is mcp</code>.</p>`,
      };
    },
  });
  def('clear', { desc: 'Clear the screen (Ctrl+L)', aliases: ['cls', 'reset'], group: 'session', deeplink: false, exec: () => actions.clear() });
  def('classic', {
    bare: false,
    desc: 'Open the classic, non-terminal site',
    aliases: ['gui', 'web', 'site'],
    group: 'session',
    deeplink: false,
    exec() {
      setTimeout(actions.goClassic, 450);
      return { html: html`<p class="o-p">Switching to the classic site…</p>` };
    },
  });

  // ---- Easter eggs (hidden from /help and the palette) ----------------------
  const egg = (name, opts) => def(name, { hidden: true, group: 'egg', deeplink: false, ...opts });

  egg('model', {
    aliases: ['models'],
    exec: () => ({
      html: html`<div class="o-title"><span class="o-title__text">Model</span><span class="o-title__meta">1 available</span></div>
        <div class="o-model"><span class="o-ok">●</span> <strong>cv-retriever-1</strong> <span class="o-muted">(current)</span><br />
        intent rules + BM25 over cv.md · params: 0 · context window: one CV · hallucinations: none, by construction</div>
        <p class="o-tip">Want the real thing? ${first} builds with them for a living: ${run('/skills ai')} · ${run('/mcp')}</p>`,
    }),
  });
  egg('cost', {
    aliases: ['usage', 'tokens', 'stats'],
    exec: () => ({
      html: html`<dl class="o-kv o-kv--tight"><dt>session cost</dt><dd>$0.00</dd><dt>tokens</dt><dd>0 in · 0 out</dd>
        <dt>questions</dt><dd>${actions.stats().questions} answered</dd><dt>GPUs harmed</dt><dd>0</dd></dl>`,
    }),
  });
  egg('doctor', {
    exec() {
      const st = actions.stats();
      const ok = (t) => html`<li><span class="o-ok">✓</span> ${t}</li>`;
      const warn = (t) => html`<li><span class="o-warn">!</span> ${t}</li>`;
      return {
        html: html`<div class="o-title"><span class="o-title__text">doctor</span><span class="o-title__meta">diagnostics</span></div><ul class="o-checks">
          ${ok(`cv.md fetched · ${(model.stats.bytes / 1024).toFixed(1)} kB · ${model.stats.lines} lines`)}
          ${ok(`${plural(model.sections.length, 'section')} parsed · ${plural(model.jobs.length, 'role')} · ${plural(model.projects.length, 'project')}`)}
          ${model.warnings.length ? model.warnings.map((w) => warn(w)) : ok('every section matched its convention, no fallbacks')}
          ${ok(`search index · ${st.docs} chunks · ${st.vocabulary} terms`)}
          ${ok(`theme: ${document.documentElement.dataset.theme} · motion: ${st.motion ? 'on' : 'reduced'}`)}
          ${ok('LLM: none detected · hallucination risk 0%')}
          ${warn('coffee level: unknown. Try /coffee')}
        </ul>`,
      };
    },
  });
  egg('hire-me', {
    aliases: ['hire', 'hireme', 'hire-gianni'],
    exec() {
      const email = model.contacts.find((c) => c.kind === 'email');
      const subject = encodeURIComponent(`Let's talk — found you via your CV terminal`);
      return {
        html: html`<pre class="o-pre">[sudo] password for recruiter: ********
<span class="o-ok">✓ access granted.</span></pre>
          <ol class="o-list o-list--num">
            ${email ? html`<li>Email ${first}: <a href="${email.href}?subject=${raw(subject)}">${email.label}</a></li>` : ''}
            <li>Grab the CV: ${run('/pdf')}</li>
            <li>Read the code: ${model.contacts.filter((c) => c.kind === 'github').map((c) => ext(c.href, c.label))}</li>
          </ol>`,
        suggest: ['/pdf', '/contact'],
      };
    },
  });
  egg('coffee', {
    aliases: ['brew', 'espresso'],
    exec: () => ({
      html: html`<pre class="o-pre o-accent" aria-hidden="true">    ( (
     ) )
  ........
  |      |]
  \\      /
   \`----'</pre><p class="o-p">Brewing an espresso… done ☕. Now, where were we? ${run('/experience')}</p>`,
    }),
  });
  egg('vim', {
    aliases: ['vi', 'nvim', 'emacs', 'nano'],
    exec: () => ({
      html: html`<p class="o-p">Opening cv.md in an editor… <span class="o-muted">E45: 'readonly' option is set.</span></p>
        <p class="o-p">This CV is read-only. You'd also never find your way out. Try ${run('/about')}.</p>`,
    }),
  });
  egg('exit', {
    aliases: ['quit', 'q', 'logout', 'bye'],
    exec: () => ({
      html: html`<p class="o-p">There's no exit from a good CV. 🙂 ${run('/classic')} for the regular site, or close the tab like it's 1999.</p>`,
    }),
  });
  egg('sudo', {
    exec(arg) {
      if (/hire/i.test(arg)) return find('hire-me').exec();
      return { html: html`<p class="o-p">guest is not in the sudoers file. This incident will be reported. <span class="o-muted">(try ${run('/sudo hire-me')})</span></p>` };
    },
  });
  egg('neofetch', {
    aliases: ['fastfetch', 'welcome', 'banner'],
    exec: () => ({ html: actions.banner(), suggest: ['/help', '/about'] }),
  });
  egg('hallucinate', {
    exec: () => ({
      html: html`<p class="o-p"><span class="o-err">✗</span> Request denied. Every answer here is retrieved from cv.md. Making things up is not supported.</p>`,
    }),
  });

  // ---- lookup / completion ------------------------------------------------
  const byName = new Map();
  list.forEach((c) => [c.name, ...c.aliases].forEach((n) => byName.set(n.toLowerCase(), c)));

  function find(name) {
    return byName.get(String(name).toLowerCase()) || null;
  }

  function parse(input) {
    const m = input.trim().match(/^\/(\S+)\s*(.*)$/s);
    return m ? { name: m[1].toLowerCase(), arg: m[2].trim() } : null;
  }

  function suggestFor(name) {
    const visible = list.filter((c) => !c.hidden);
    const pref = visible.filter((c) => c.name.startsWith(name));
    if (pref.length) return pref.slice(0, 3);
    return visible
      .map((c) => ({ c, d: levenshtein(name, c.name) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => x.c);
  }

  async function exec(input) {
    const p = parse(input);
    if (!p) return null;
    const cmd = find(p.name);
    if (!cmd) {
      const near = suggestFor(p.name);
      return {
        ...err(html`Unknown command <code>/${p.name}</code>.${near.length ? html` Did you mean ${near.map((c, i) => html`${i ? ', ' : ''}${run(`/${c.name}`)}`)}?` : ''} ${run('/help')} lists everything.`),
        deeplink: false,
      };
    }
    const result = await cmd.exec(p.arg);
    return result ? { deeplink: cmd.deeplink, command: cmd.name, ...result } : { deeplink: cmd.deeplink, command: cmd.name };
  }

  /** Palette entries for what's typed so far (starts with "/"). */
  function complete(value) {
    const m = value.match(/^\/(\S*)(\s+)?(.*)$/s);
    if (!m) return [];
    const [, name, space, argPart] = m;
    if (!space) {
      const q = name.toLowerCase();
      const visible = list.filter((c) => !c.hidden);
      const starts = visible.filter((c) => c.name.startsWith(q) || c.aliases.some((a) => a.startsWith(q) && q.length > 1));
      const contains = q.length > 1 ? visible.filter((c) => !starts.includes(c) && c.name.includes(q)) : [];
      return [...starts, ...contains].map((c) => ({
        value: `/${c.name}`,
        label: `/${c.name}`,
        hint: c.args,
        desc: c.desc,
        takesArgs: !!c.complete,
      }));
    }
    const cmd = find(name);
    if (!cmd?.complete) return [];
    const a = argPart.toLowerCase();
    return cmd.complete().filter((o) => o.label.toLowerCase().startsWith(a) || (a.length > 1 && o.desc.toLowerCase().includes(a)));
  }

  function help() {
    const vis = list.filter((c) => !c.hidden);
    const row = (c) =>
      html`<div class="o-help__row">${run(`/${c.name}`, `/${c.name}`, 'o-help__cmd')}<span class="o-help__args">${c.args}</span><span class="o-help__desc">${c.desc}${c.aliases.length ? html` <span class="o-muted">· ${c.aliases.slice(0, 2).map((a) => `/${a}`).join(' ')}</span>` : ''}</span></div>`;
    const examples = ctx.examples();
    return {
      html: html`<div class="o-title"><span class="o-title__text">Commands</span><span class="o-title__meta">type / to autocomplete</span></div>
        <div class="o-help">${vis.filter((c) => c.group === 'cv').map(row)}</div>
        <div class="o-title o-title--sub"><span class="o-title__text">Session</span></div>
        <div class="o-help">${vis.filter((c) => c.group === 'session').map(row)}</div>
        <div class="o-title o-title--sub"><span class="o-title__text">Or just ask</span><span class="o-title__meta">answered offline from cv.md</span></div>
        <ul class="o-asks">${examples.map((q) => html`<li>${run(q, html`<span aria-hidden="true">›</span> ${q}`, 'o-ask')}</li>`)}</ul>
        <p class="o-tip">Keys: <kbd>Tab</kbd> complete · <kbd>↑</kbd><kbd>↓</kbd> history · <kbd>Ctrl</kbd>+<kbd>L</kbd> clear · <kbd>Esc</kbd> skip animation</p>
        <p class="o-tip">psst: a few commands aren't listed. Real CLIs have easter eggs too.</p>`,
      suggest: ['/about', '/experience', '/skills', ...examples.slice(0, 2)],
    };
  }

  return { list, find, exec, complete, parse };
}
