// Renderers. Every view returns { html, suggest? } where `html` is a SafeHtml
// string and `suggest` feeds the suggestion bar under the transcript.
// cv.md-derived markup goes through raw(); everything else is escaped.

import { html, raw, run, ext, plural, fmtDuration, fmtYM, months, slug } from './util.js';
import { statedYears, careerStart, currentJob } from './model.js';

export function createViews(model, facts) {
  const J = model.jobs;

  // ---- building blocks ----------------------------------------------------
  const title = (text, meta) =>
    html`<div class="o-title"><span class="o-title__text">${text}</span>${meta ? html`<span class="o-title__meta">${meta}</span>` : ''}</div>`;
  const tip = (...parts) => html`<p class="o-tip">${parts}</p>`;
  const jobCmd = (j) => `/experience ${j.n}`;
  const dur = (j) => (j.range ? fmtDuration(months(j.range)) : '');
  const where = (j) => [j.company, j.team].filter(Boolean).join(' · ');
  const ref = (cmd, label, hint) =>
    html`<button type="button" class="run ref" data-run="${cmd}"${hint ? html` title="${hint}"` : ''}>${label}</button>`;
  const chips = (items) =>
    html`<ul class="o-chips">${items.map(
      (it) => html`<li>${it.cmd ? run(it.cmd, it.label, 'chip') : html`<span class="chip">${it.label}</span>`}</li>`,
    )}</ul>`;
  const mail = (c) => html`<a href="${c.href}">${c.label}</a>`;
  const link = (c) => (c.href?.startsWith('mailto:') ? mail(c) : c.href ? ext(c.href, c.label) : c.label);

  const jobRows = (list) =>
    html`<div class="o-rows">${list.map(
      (j) => html`<button type="button" class="o-row run" data-run="${jobCmd(j)}"><span class="o-row__n">${j.n}</span><span class="o-row__when">${j.dates}</span><span class="o-row__main"><span class="o-row__title">${j.title}</span><span class="o-row__sub">${where(j)}${j.range ? ` · ${dur(j)}` : ''}</span></span></button>`,
    )}</div>`;

  const refsOf = (u) => {
    const parts = [
      ...u.jobs.map((j) => ref(jobCmd(j), `#${j.n}`, `${j.title} · ${j.company}`)),
      ...u.projects.map((p) => ref(`/projects ${p.slug}`, p.name, p.tech.join(' · '))),
    ];
    if (u.summary && !parts.length) parts.push(ref('/about', 'summary'));
    return parts.length ? parts : html`<span class="o-muted">—</span>`;
  };

  // Example arguments, derived from the CV so hints never point at nothing.
  const stackCounts = new Map();
  J.forEach((j) => j.stack.forEach((s) => stackCounts.set(s, (stackCounts.get(s) || 0) + 1)));
  const topStack = [...stackCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Java';
  const exampleCompany = facts.companies[0] || '';
  const exampleYear =
    J.flatMap((j) => j.bullets).find((b) => b.range)?.range.start.y ||
    J.find((j) => j.range && !j.range.current)?.range.start.y ||
    '';

  // ---- section views ------------------------------------------------------
  function about() {
    const s = model.summary;
    if (!s) return generic(model.sections.find((x) => x.command === 'about'));
    return {
      html: html`${title(model.name, model.roles.join(' · '))}
        ${s.paragraphs.map((p) => html`<p class="o-p">${raw(p)}</p>`)}
        ${s.highlights.length
          ? html`<ul class="o-hl">${s.highlights.map(
              (h) => html`<li><span class="o-hl__icon" aria-hidden="true">${h.icon || '•'}</span><span><strong>${h.title}</strong> — ${raw(h.html)}</span></li>`,
            )}</ul>`
          : ''}
        ${tip('Next: ', run('/experience'), ' · ', run('/skills'), ' · ', run('/projects'), ' · ', run('/contact'))}`,
      suggest: ['/experience', '/skills', '/projects', '/mcp', 'Why should we hire Gianni?'],
    };
  }

  function experience(list = J, heading = 'Professional Experience') {
    if (!J.length) return generic(model.sections.find((x) => x.command === 'experience'));
    const start = careerStart(model);
    const meta = [plural(list.length, 'role'), list === J && start ? `since ${fmtYM(start)}` : ''].filter(Boolean).join(' · ');
    return {
      html: html`${title(heading, meta)}
        ${jobRows(list)}
        ${tip(
          'Details: ',
          run(jobCmd(list[0])),
          exampleCompany ? html` · by company: ${run(`/experience ${exampleCompany}`)}` : '',
          exampleYear ? html` · by year: ${run(`/experience ${exampleYear}`)}` : '',
        )}`,
      suggest: [...list.slice(0, 3).map(jobCmd), '/skills', '/projects'],
    };
  }

  function job(j) {
    const prev = J[j.n - 2];
    const next = J[j.n];
    return {
      html: html`${title(j.title, `${j.n}/${J.length}`)}
        <p class="o-meta"><span class="o-accent">${j.company}</span>${j.team ? ` · ${j.team}` : ''} · <span class="o-dates">${j.dates}</span>${j.range ? html` <span class="o-muted">(${dur(j)})</span>` : ''}</p>
        ${j.descriptor ? html`<p class="o-desc">${j.descriptor}</p>` : ''}
        ${j.intro.map((h) => html`<p class="o-p">${raw(h)}</p>`)}
        ${j.bullets.length ? html`<ul class="o-list">${j.bullets.map((b) => html`<li>${raw(b.html)}</li>`)}</ul>` : ''}
        ${j.stack.length
          ? html`<div class="o-stack"><span class="o-label">stack</span>${chips(j.stack.map((s) => ({ label: s, cmd: `/skills ${s}` })))}</div>`
          : ''}
        ${tip(prev ? html`← ${run(jobCmd(prev))} ` : '', next ? html`→ ${run(jobCmd(next))} ` : '', '· ', run('/experience', 'all roles'))}`,
      suggest: [next && jobCmd(next), prev && jobCmd(prev), j.stack[0] && `/skills ${j.stack[0]}`, '/projects'].filter(Boolean),
    };
  }

  function skills() {
    if (!model.skills.length) return generic(model.sections.find((x) => x.command === 'skills'));
    const total = model.skills.reduce((a, c) => a + c.skills.length, 0);
    return {
      html: html`${title('Core Competencies', `${total} skills · ${plural(model.skills.length, 'category', 'categories')}`)}
        ${model.skills.map(
          (c) => html`<div class="o-group"><div class="o-group__head">${run(`/skills ${c.key}`, c.name, 'o-group__name')} <span class="o-muted">${c.skills.length}</span></div>${chips(c.skills.map((s) => ({ label: s, cmd: `/skills ${s}` })))}</div>`,
        )}
        ${tip('Where each skill was used: ', run(`/skills ${model.skills[0].key}`), ' · one skill: ', run(`/skills ${topStack}`))}`,
      suggest: model.skills.slice(0, 4).map((c) => `/skills ${c.key}`).concat(`/skills ${topStack}`),
    };
  }

  function category(c) {
    const rows = c.skills.map((s) => ({ s, u: facts.usageOf(s) }));
    const jobsSeen = new Set(rows.flatMap((r) => r.u.jobs));
    const projSeen = new Set(rows.flatMap((r) => r.u.projects));
    const others = model.skills.filter((x) => x !== c);
    return {
      html: html`${title(c.name, plural(c.skills.length, 'skill'))}
        <div class="o-usage" role="list">${rows.map(
          ({ s, u }) => html`<div class="o-usage__row" role="listitem">${run(`/skills ${s}`, s, 'o-usage__skill')}<span class="o-usage__refs">${refsOf(u)}</span></div>`,
        )}</div>
        ${tip(
          `Seen in ${plural(jobsSeen.size, 'role')} and ${plural(projSeen.size, 'project')}. #n = role, see `,
          run('/experience'),
          '.',
        )}
        ${tip('Other categories: ', others.map((x, i) => html`${i ? ' · ' : ''}${run(`/skills ${x.key}`)}`))}`,
      suggest: [...[...jobsSeen].slice(0, 2).map(jobCmd), ...others.slice(0, 2).map((x) => `/skills ${x.key}`)],
    };
  }

  function skill(res) {
    if (!res.found) return notInCv(res.display);
    const cats = [...new Set(res.cats.map((h) => h.cat))];
    return {
      html: html`${title(res.display, cats.map((c) => c.name).join(' · ') || 'mentioned in the CV')}
        <dl class="o-kv">
          ${res.cats.length
            ? html`<dt>listed as</dt><dd>${res.cats.map(
                (h, i) => html`${i ? ' · ' : ''}${h.skill} <span class="o-muted">(${run(`/skills ${h.cat.key}`, h.cat.name)})</span>`,
              )}</dd>`
            : ''}
          ${res.jobs.length
            ? html`<dt>roles</dt><dd>${res.jobs.map(
                (j) => html`<div>${ref(jobCmd(j), `#${j.n}`)} ${j.title} <span class="o-muted">· ${j.company} · ${j.dates}</span></div>`,
              )}</dd>`
            : ''}
          ${res.months ? html`<dt>span</dt><dd>roles totalling ≈ ${fmtDuration(res.months)}</dd>` : ''}
          ${res.projects.length
            ? html`<dt>projects</dt><dd>${res.projects.map(
                (p, i) => html`${i ? ' · ' : ''}${run(`/projects ${p.slug}`, `${p.icon} ${p.name}`.trim())}`,
              )}</dd>`
            : ''}
          ${res.certs.length ? html`<dt>certified</dt><dd>${res.certs.map((c) => html`<div>${raw(c.html)}</div>`)}</dd>` : ''}
          ${res.summary ? html`<dt>summary</dt><dd>${run('/about', 'mentioned in the professional summary')}</dd>` : ''}
        </dl>`,
      suggest: [...res.jobs.slice(0, 2).map(jobCmd), ...cats.slice(0, 1).map((c) => `/skills ${c.key}`), '/skills'],
    };
  }

  function notInCv(thing, related = [], typos = []) {
    const label = thing === thing.toLowerCase() ? thing.charAt(0).toUpperCase() + thing.slice(1) : thing;
    return {
      html: html`<p class="o-p"><span class="o-warn">✗</span> <strong>${label}</strong> isn't mentioned in the CV.</p>
        ${typos.length ? html`<p class="o-p">Did you mean ${typos.map((t, i) => html`${i ? ', ' : ''}${run(`/skills ${t}`, t)}`)}?</p>` : ''}
        ${related.length
          ? html`<p class="o-p">Closest things that <em>are</em> in it: ${related.map((t, i) => html`${i ? ' · ' : ''}${run(`/skills ${t}`, t)}`)}</p>`
          : ''}
        ${tip('Browse everything: ', run('/skills'), ' · or ask Gianni directly: ', run('/contact'))}`,
      suggest: ['/skills', ...related.slice(0, 2).map((t) => `/skills ${t}`), '/contact'],
    };
  }

  function projects() {
    if (!model.projects.length) return generic(model.sections.find((x) => x.command === 'projects'));
    return {
      html: html`${title('Open Source & Side Projects', plural(model.projects.length, 'project'))}
        ${model.projectsIntro ? html`<p class="o-p o-muted">${raw(model.projectsIntro)}</p>` : ''}
        <div class="o-cards">${model.projects.map(
          (p) => html`<div class="o-card"><div class="o-card__head">${run(`/projects ${p.slug}`, `${p.icon} ${p.name}`.trim(), 'o-card__name')}${p.href ? html` <a class="o-card__link" href="${p.href}" target="_blank" rel="noopener noreferrer" aria-label="${p.name} source code (opens in a new tab)">↗</a>` : ''}</div><div class="o-card__tech">${p.tech.join(' · ')}</div><p class="o-card__desc">${raw(p.html)}</p></div>`,
        )}</div>
        ${model.projectsNotes.map((n) => html`<p class="o-p o-muted">${raw(n.html)}</p>`)}`,
      suggest: model.projects.slice(0, 4).map((p) => `/projects ${p.slug}`),
    };
  }

  function project(p) {
    const others = model.projects.filter((x) => x !== p);
    return {
      html: html`${title(`${p.icon} ${p.name}`.trim(), p.href ? 'open source' : '')}
        <p class="o-p">${raw(p.html)}</p>
        ${p.tech.length ? html`<div class="o-stack"><span class="o-label">tech</span>${chips(p.tech.map((t) => ({ label: t, cmd: `/skills ${t}` })))}</div>` : ''}
        ${p.href ? html`<p class="o-p">→ ${ext(p.href, p.href.replace(/^https?:\/\//, ''))}</p>` : ''}
        ${tip('More: ', others.map((x, i) => html`${i ? ' · ' : ''}${run(`/projects ${x.slug}`, x.name)}`))}`,
      suggest: [...others.slice(0, 3).map((x) => `/projects ${x.slug}`), '/projects'],
    };
  }

  function mcp() {
    const projs = model.projects.filter((p) => /\bmcp\b/i.test(`${p.name} ${p.tech.join(' ')}`));
    const internal = J.flatMap((j) =>
      j.bullets.filter((b) => /\bmcp\b|model context protocol/i.test(b.text)).map((b) => ({ j, b })),
    );
    const n = projs.length + internal.length;
    const cat = model.skills.find((c) => c.skills.some((s) => /\bmcp\b/i.test(s)));
    if (!n) {
      return {
        html: html`${title('MCP servers', '0 configured')}<p class="o-p o-muted">No MCP work is mentioned in the CV right now.</p>`,
        suggest: ['/projects', '/skills'],
      };
    }
    return {
      html: html`${title('MCP servers', `${n} connected · built by ${model.name.split(' ')[0]}`)}
        <div class="o-servers">
          ${projs.map(
            (p) => html`<div class="o-server"><div class="o-server__head"><span class="o-ok" aria-hidden="true">●</span> ${run(`/projects ${p.slug}`, p.name, 'o-server__name')} <span class="o-ok">✓ connected</span> <span class="o-muted">· public</span>${p.href ? html` · ${ext(p.href, 'source ↗')}` : ''}</div><div class="o-server__body">${raw(p.html)}</div><div class="o-server__meta">${p.tech.join(' · ')}</div></div>`,
          )}
          ${internal.map(
            ({ j, b }) => html`<div class="o-server"><div class="o-server__head"><span class="o-ok" aria-hidden="true">●</span> <span class="o-server__name">${slug(j.company)}-internal</span> <span class="o-ok">✓ connected</span> <span class="o-muted">· private</span></div><div class="o-server__body">${raw(b.html)}</div><div class="o-server__meta">${ref(jobCmd(j), `#${j.n}`)} ${j.title} · ${j.company} · ${j.dates}</div></div>`,
          )}
        </div>
        ${cat ? tip('Listed under ', run(`/skills ${cat.key}`, cat.name), ' in Core Competencies.') : ''}`,
      suggest: [...projs.map((p) => `/projects ${p.slug}`), ...internal.slice(0, 1).map(({ j }) => jobCmd(j)), cat ? `/skills ${cat.key}` : '/skills'],
    };
  }

  function listView(cmd, heading, items, icon) {
    const s = model.sections.find((x) => x.command === cmd);
    if (!items.length) return generic(s);
    return {
      html: html`${title(s?.title || heading)}<ul class="o-list o-list--icon" style="--icon: '${icon}'">${items.map((it) => html`<li>${raw(it.html)}</li>`)}</ul>`,
      suggest: ['/experience', '/skills', '/contact'],
    };
  }

  const education = () => listView('education', 'Education', model.education, '🎓');
  const certifications = () => listView('certifications', 'Certifications', model.certifications, '✓');
  const publications = () => listView('publications', 'Publications', model.publications, '¶');

  function languages() {
    if (!model.languages.length) return generic(model.sections.find((x) => x.command === 'languages'));
    return {
      html: html`${title('Languages', 'spoken')}
        <dl class="o-kv">${model.languages.map((l) => html`<dt>${l.icon ? html`<span aria-hidden="true">${l.icon}</span> ` : ''}${l.label}</dt><dd>${l.level}</dd>`)}</dl>
        ${tip('Programming languages live in ', run(`/skills ${facts.categoryByKey('languages')?.key || 'languages'}`), '.')}`,
      suggest: ['/education', '/contact'],
    };
  }

  function contact() {
    return {
      html: html`${title('Contact', model.name)}
        <dl class="o-kv">${model.contacts.map(
          (c) => html`<dt>${['info', 'link'].includes(c.kind) ? c.icon || 'link' : c.kind}</dt><dd>${link(c)}</dd>`,
        )}<dt>cv</dt><dd>${run('/pdf', 'download the PDF')} · ${run('/classic', 'classic site')}</dd></dl>`,
      suggest: ['/pdf', '/about', '/projects'],
    };
  }

  function generic(s) {
    if (!s) return { html: html`<p class="o-p o-muted">That section isn't in the CV right now.</p>`, suggest: ['/help'] };
    return { html: html`${title(s.title)}<div class="o-md">${raw(s.html)}</div>`, suggest: ['/help'] };
  }

  // ---- composite views (used by the answer engine) --------------------------
  function now() {
    const j = currentJob(model);
    if (!j) return about();
    const isCurrent = !!j.range?.current;
    return {
      html: html`<p class="o-p">${isCurrent ? 'Right now Gianni is' : 'Most recent role:'} <strong>${j.title}</strong> at <span class="o-accent">${j.company}</span>${j.team ? ` (${j.team})` : ''}, ${isCurrent ? html`since ${fmtYM(j.range.start)} <span class="o-muted">(${dur(j)})</span>` : j.dates}.</p>
        ${j.descriptor ? html`<p class="o-p">Main product: <em>${j.descriptor.replace(/\.$/, '')}</em>.</p>` : ''}
        ${j.bullets.length ? html`<p class="o-p">Top of the list:</p><ul class="o-list">${j.bullets.slice(0, 3).map((b) => html`<li>${raw(b.html)}</li>`)}</ul>` : ''}
        ${tip('Full role: ', run(jobCmd(j)), ' · everything else: ', run('/experience'))}`,
      suggest: [jobCmd(j), '/mcp', '/experience', '/skills'],
    };
  }

  function years() {
    const stated = statedYears(model);
    const start = careerStart(model);
    const first = start && J.find((j) => j.range && j.range.start.y === start.y && j.range.start.m === start.m);
    return {
      html: html`<p class="o-p">${stated ? html`<strong>${stated}</strong> of professional experience, according to the summary.` : ''}
        ${start ? html` First role listed: <strong>${first?.title || ''}</strong> at ${first?.company || ''}, starting <span class="o-dates">${fmtYM(start)}</span>.` : ''}
        ${J.length ? html` ${plural(J.length, 'role')} since then.` : ''}</p>
        ${tip('Timeline: ', run('/experience'))}`,
      suggest: ['/experience', '/about'],
    };
  }

  function pitch() {
    const j = currentJob(model);
    const firstSentence = (model.summary?.text.match(/^.*?\.(?=\s|$)/) || [''])[0];
    return {
      html: html`<p class="o-p">The short pitch, straight from the CV:</p>
        <ul class="o-list">
          ${firstSentence ? html`<li>${firstSentence}</li>` : ''}
          ${j ? html`<li>Now: <strong>${j.title}</strong> at ${j.company}${j.range?.current ? ` (since ${fmtYM(j.range.start)})` : ''}.</li>` : ''}
          ${(model.summary?.highlights || []).map((h) => html`<li>${h.icon} <strong>${h.title}</strong> — ${raw(h.html)}</li>`)}
        </ul>
        ${tip('Convinced? ', run('/contact'), ' · ', run('/pdf'), ' · still curious: ', run('/projects'))}`,
      suggest: ['/contact', '/pdf', j ? jobCmd(j) : '/experience', '/projects'],
    };
  }

  /**
   * What was going on in year `y`: roles active that year, plus dated
   * initiatives ("NDC API integration (2018–2021)") running that year. An
   * initiative's own dates can outlast the role it is listed under (a project
   * that continued after a contract ended), so initiatives are collected from
   * every role, and the ones outside an active role say where they're listed.
   */
  function inYear(y) {
    const covers = (r) => !!r && r.start.y <= y && (r.end ? r.end.y : new Date().getFullYear()) >= y;
    const active = J.filter((j) => covers(j.range));
    const running = J.flatMap((j) => j.bullets.filter((b) => covers(b.range)).map((b) => ({ j, b })));
    const beyond = running.filter(({ j }) => !active.includes(j));
    const start = careerStart(model);
    if (!active.length && !beyond.length) {
      const edu = model.education.filter((e) => e.range && e.range.start.y <= y && e.range.end.y >= y);
      const before = start && y < start.y;
      const future = y > new Date().getFullYear();
      return {
        html: html`<p class="o-p">${future
          ? `${y} hasn't happened yet. Ask again later.`
          : edu.length
            ? html`In ${y} Gianni was studying:`
            : before
              ? `The CV starts in ${fmtYM(start)}; nothing is listed for ${y}.`
              : `No role is listed for ${y} in the CV.`}</p>
          ${edu.length ? html`<ul class="o-list">${edu.map((e) => html`<li>${raw(e.html)}</li>`)}</ul>` : ''}
          ${tip('Timeline: ', run('/experience'), future ? '' : html` · ask Gianni: ${run('/contact')}`)}`,
        suggest: ['/experience', '/education'],
      };
    }
    const listedUnder = ({ j, b }) =>
      html`<div class="o-hit"><div class="o-hit__src">${ref(jobCmd(j), `#${j.n}`)} <span class="o-muted">listed under ${j.title} · ${j.company} · ${j.dates}</span></div><p class="o-hit__text">${raw(b.html)}</p></div>`;
    return {
      html: html`<p class="o-p">${active.length ? html`In <strong>${y}</strong>:` : html`In <strong>${y}</strong>, Gianni was working on:`}</p>
        ${active.length ? jobRows(active) : ''}
        ${active.map((j) => {
          const items = running.filter((x) => x.j === j).map((x) => x.b);
          return items.length
            ? html`<p class="o-p o-muted">Initiatives that year at ${j.company}:</p><ul class="o-list">${items.map((b) => html`<li>${raw(b.html)}</li>`)}</ul>`
            : '';
        })}
        ${beyond.length && active.length ? html`<p class="o-p o-muted">Also running that year, by its own dates:</p>` : ''}
        ${beyond.length ? html`<div class="o-hits">${beyond.map(listedUnder)}</div>` : ''}`,
      suggest: [...new Set([...active, ...beyond.map((x) => x.j)].map(jobCmd)), '/experience'],
    };
  }

  function company(name) {
    const list = facts.jobsAt(name);
    if (!list.length) return null;
    const display = list[0].company.toLowerCase().startsWith(name) ? list[0].company : name;
    const total = list.reduce((a, j) => a + months(j.range), 0);
    return {
      html: html`<p class="o-p"><strong>${display}</strong>: ${plural(list.length, 'role')}, ≈ ${fmtDuration(total)} in total.</p>
        ${jobRows(list)}
        ${list.some((j) => j.contractorFor)
          ? html`<p class="o-p o-muted">Includes contractor work for ${list.find((j) => j.contractorFor).contractorFor} via ${list.find((j) => j.contractorFor).company}.</p>`
          : ''}`,
      suggest: [...list.slice(0, 3).map(jobCmd), '/experience'],
    };
  }

  /** hits: [{ doc, snippetHtml }] — snippetHtml is pre-escaped by search.snippet(). */
  function results(hits, query) {
    return {
      html: html`<p class="o-p">Here's what the CV says about “${query}”:</p>
        <div class="o-hits">${hits.map(
          (h) => html`<div class="o-hit"><div class="o-hit__src">${ref(h.doc.ref, h.doc.label)}</div><p class="o-hit__text">${raw(h.snippetHtml)}</p></div>`,
        )}</div>`,
      suggest: [...new Set(hits.map((h) => h.doc.ref))].slice(0, 4),
    };
  }

  return {
    // building blocks reused by commands/answers
    title, tip, chips, jobRows, jobCmd, ref,
    // section views
    about, experience, job, skills, category, skill, notInCv, projects, project, mcp,
    education, certifications, publications, languages, contact, generic,
    // composites
    now, years, pitch, inYear, company, results,
    // derived examples
    examples: { topStack, exampleCompany, exampleYear },
  };
}
