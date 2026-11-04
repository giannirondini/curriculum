// cv.md -> structured model.
//
// Same conventions as the classic site's enrichment passes (see CLAUDE.md):
// header (H1, bold subtitle, contacts), one `## Section` per block, jobs as
// `### Title` + meta line + optional *descriptor* + bullets + **Stack:** line,
// projects as `**[Name](url)** — *Tech · Tech*` list items, 2-column tables.
//
// Each section is parsed in isolation. If a section breaks the convention its
// parser throws, the section is downgraded to `kind: 'generic'` (rendered as
// plain markdown output) and a warning is recorded. The rest still works.

import { tokenizeSkill } from '../../shared/skill-match.js';
import { slug, norm, splitIcon, parseRange } from './util.js';

const SECTION_COMMANDS = {
  summary: 'about',
  skills: 'skills',
  experience: 'experience',
  projects: 'projects',
  education: 'education',
  certifications: 'certifications',
  languages: 'languages',
  publications: 'publications',
};

function kindOf(id) {
  if (/summary|about|profile/.test(id)) return 'summary';
  if (/competenc|skills/.test(id)) return 'skills';
  if (/experience|employment|career/.test(id)) return 'experience';
  if (/project|open-source/.test(id)) return 'projects';
  if (/education|studies/.test(id)) return 'education';
  if (/certif/.test(id)) return 'certifications';
  if (/language/.test(id)) return 'languages';
  if (/publication|papers/.test(id)) return 'publications';
  return 'generic';
}

export function buildModel(md, markedLib) {
  const root = document.createElement('div');
  root.innerHTML = markedLib.parse(md, { gfm: true, breaks: false });

  const model = {
    name: '',
    tagline: '',
    roles: [],
    contacts: [],
    sections: [],
    summary: null,
    skills: [],
    jobs: [],
    projects: [],
    projectsIntro: '',
    projectsNotes: [],
    education: [],
    certifications: [],
    languages: [],
    publications: [],
    warnings: [],
    stats: { bytes: md.length, lines: md.split('\n').length },
  };

  // Split header vs `## sections` (HRs are visual separators only).
  const header = [];
  let current = null;
  for (const node of [...root.children]) {
    if (node.tagName === 'H2') {
      const title = node.textContent.trim();
      current = { id: slug(title), title, nodes: [] };
      model.sections.push(current);
    } else if (node.tagName !== 'HR') {
      (current ? current.nodes : header).push(node);
    }
  }

  parseHeader(model, header);

  const usedCommands = new Set();
  for (const s of model.sections) {
    s.kind = kindOf(s.id);
    // Two sections of the same kind? The second one becomes generic.
    if (s.kind !== 'generic' && usedCommands.has(s.kind)) s.kind = 'generic';
    usedCommands.add(s.kind);
    s.html = s.nodes.map((n) => n.outerHTML).join('\n');
    s.text = s.nodes.map((n) => n.textContent.trim()).join('\n');
    // Command name is fixed before parsing: if parsing fails, `/experience`
    // still exists and renders the section as plain markdown.
    s.command = SECTION_COMMANDS[s.kind] || s.id;
    try {
      PARSERS[s.kind]?.(model, s);
    } catch (e) {
      model.warnings.push(`#${s.id}: ${e.message} (shown as plain markdown)`);
      console.warn(`[cli] parsing failed for #${s.id}; falling back to plain output.`, e);
      s.kind = 'generic';
    }
  }

  return model;
}

// ---------------------------------------------------------------------------

function parseHeader(model, nodes) {
  const h1 = nodes.find((n) => n.tagName === 'H1');
  model.name = h1?.textContent.trim() || 'Anonymous';

  const ps = nodes.filter((n) => n.tagName === 'P');
  const subtitle = ps[0];
  model.tagline = (subtitle?.querySelector('strong') || subtitle)?.textContent.trim() || '';
  model.roles = model.tagline.split('·').map((s) => s.trim()).filter(Boolean);

  const contacts = ps[1];
  if (!contacts) return;
  model.contacts = contacts.innerHTML
    .split(/\s*·\s*/)
    .map((part) => {
      const tmp = document.createElement('span');
      tmp.innerHTML = part;
      const a = tmp.querySelector('a');
      const { icon, label } = splitIcon(tmp.textContent);
      let href = a?.getAttribute('href') || '';
      if (!href && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(label)) href = `mailto:${label}`;
      if (href && !/^(https?:|mailto:)/i.test(href)) href = `https://${href}`;
      const probe = `${href} ${label}`.toLowerCase();
      const kind = probe.includes('mailto:')
        ? 'email'
        : probe.includes('github.com')
          ? 'github'
          : probe.includes('linkedin')
            ? 'linkedin'
            : /nationality|citizen/.test(probe)
              ? 'nationality'
              : href
                ? 'link'
                : 'info';
      return { icon, label, href, kind };
    })
    .filter((c) => c.label);
}

const PARSERS = {
  summary(model, s) {
    const paras = s.nodes.filter((n) => n.tagName === 'P');
    const ul = s.nodes.find((n) => n.tagName === 'UL');
    if (!paras.length) throw new Error('no summary paragraph');
    model.summary = {
      paragraphs: paras.map((p) => p.innerHTML),
      text: paras.map((p) => p.textContent.trim()).join(' '),
      highlights: ul ? [...ul.children].map(parseHighlight) : [],
    };
  },

  skills(model, s) {
    const table = s.nodes.find((n) => n.tagName === 'TABLE');
    if (!table) throw new Error('no skills table');
    const cats = [...table.querySelectorAll('tbody tr')]
      .map((tr) => tr.querySelectorAll('td'))
      .filter((cells) => cells.length >= 2)
      .map((cells) => {
        const name = cells[0].textContent.trim();
        const skills = cells[1].textContent.split('·').map((x) => x.trim()).filter(Boolean);
        return { name, slug: slug(name), skills };
      });
    if (!cats.length) throw new Error('empty skills table');
    // Short command keys: first word of the name ("ai", "cloud", "devops"…),
    // falling back to the full slug on collision.
    const seen = new Map();
    cats.forEach((c) => {
      const k = slug(c.name).split('-')[0];
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    cats.forEach((c) => {
      const k = slug(c.name).split('-')[0];
      c.key = seen.get(k) > 1 ? c.slug : k;
      c.words = norm(c.name)
        .split(' ')
        .filter((w) => w.length > 1 && !['and', 'engineering'].includes(w));
    });
    model.skills = cats;
  },

  experience(model, s) {
    const jobs = [];
    let job = null;
    for (const n of s.nodes) {
      if (n.tagName === 'H3') {
        job = { title: n.textContent.trim(), nodes: [] };
        jobs.push(job);
      } else if (job) {
        job.nodes.push(n);
      }
    }
    if (!jobs.length) throw new Error('no `### Job` headings');
    model.jobs = jobs.map(parseJob);
  },

  projects(model, s) {
    const ulIndex = s.nodes.findIndex((n) => n.tagName === 'UL');
    if (ulIndex < 0) throw new Error('no project list');
    model.projectsIntro = s.nodes
      .slice(0, ulIndex)
      .filter((n) => n.tagName === 'P')
      .map((p) => p.innerHTML)
      .join(' ');
    model.projectsNotes = s.nodes
      .slice(ulIndex + 1)
      .filter((n) => n.tagName === 'P')
      .map((p) => ({ html: p.innerHTML, text: p.textContent.trim() }));
    model.projects = [...s.nodes[ulIndex].children].map(parseProject);
  },

  education(model, s) {
    model.education = listItems(s).map((it) => ({ ...it, range: parseRange(it.text) }));
  },

  certifications(model, s) {
    model.certifications = listItems(s);
  },

  publications(model, s) {
    model.publications = listItems(s);
  },

  languages(model, s) {
    const table = s.nodes.find((n) => n.tagName === 'TABLE');
    if (!table) throw new Error('no languages table');
    model.languages = [...table.querySelectorAll('tbody tr')]
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
      .filter((cells) => cells.length >= 2)
      .map(([lang, level]) => ({ ...splitIcon(lang), level }));
  },
};

function parseHighlight(li) {
  const strong = li.querySelector('strong');
  const { icon } = splitIcon(li.textContent);
  const clone = li.cloneNode(true);
  clone.querySelector('strong')?.remove();
  const rest = clone.innerHTML.replace(/^[^<\p{L}\p{N}]*?[—–-]\s*/u, '').trim();
  const tmp = document.createElement('span');
  tmp.innerHTML = rest;
  return {
    icon,
    title: strong?.textContent.trim() || '',
    html: rest,
    text: tmp.textContent.trim(),
  };
}

function parseJob(j, i) {
  const ps = j.nodes.filter((n) => n.tagName === 'P');
  const meta = ps[0];
  if (!meta?.querySelector('strong')) throw new Error(`job "${j.title}" has no **Company** line`);

  const company = meta.querySelector('strong').textContent.trim();
  const dates = meta.querySelector('em')?.textContent.trim() || '';
  const clone = meta.cloneNode(true);
  clone.querySelector('strong')?.remove();
  clone.querySelector('em')?.remove();
  const team = clone.textContent.replace(/[·\s]+/g, ' ').trim();

  const rest = ps.slice(1);
  const stackP = rest.find((p) =>
    /^stack\b/i.test(p.querySelector('strong')?.textContent.trim() || ''),
  );
  const stack = stackP
    ? stackP.textContent
        .slice(stackP.textContent.indexOf(':') + 1)
        .split('·')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const descP = rest.find((p) => {
    if (p === stackP) return false;
    const em = p.querySelector('em');
    return em && em.textContent.trim() === p.textContent.trim();
  });
  const intro = rest.filter((p) => p !== stackP && p !== descP);

  const ul = j.nodes.find((n) => n.tagName === 'UL');
  const bullets = ul
    ? [...ul.children].map((li) => ({
        html: li.innerHTML,
        text: li.textContent.replace(/\s+/g, ' ').trim(),
        range: parseRange((li.textContent.match(/\((?:19|20)\d{2}[^)]*\)/) || [''])[0]),
        lead: li.querySelector('strong')?.textContent.trim().replace(/:$/, '') || '',
      }))
    : [];

  const descriptor = descP?.textContent.trim() || '';
  const introText = intro.map((p) => p.textContent.trim());
  return {
    n: i + 1,
    title: j.title,
    company,
    team,
    dates,
    range: parseRange(dates),
    descriptor,
    intro: intro.map((p) => p.innerHTML),
    bullets,
    stack,
    contractorFor: (j.title.match(/contractor for ([^)]+)/i) || [])[1]?.trim() || '',
    text: [j.title, company, team, descriptor, ...introText, ...bullets.map((b) => b.text)].join(' '),
  };
}

function parseProject(li) {
  const strong = li.querySelector('strong');
  const link = strong?.querySelector('a') || li.querySelector('a');
  const { icon, label } = splitIcon((link || strong)?.textContent || 'Project');
  const em = li.querySelector('em');
  const tech = em
    ? em.textContent.split('·').map((t) => t.trim()).filter(Boolean)
    : [];

  const clone = li.cloneNode(true);
  clone.querySelector('strong')?.remove();
  clone.querySelector('em')?.remove();
  const box = clone.querySelector('p') || clone;
  const descHtml = box.innerHTML.replace(/^[\s—–-]+/, '').trim();
  const tmp = document.createElement('div');
  tmp.innerHTML = descHtml;

  return {
    icon,
    name: label,
    slug: slug(label),
    href: link?.getAttribute('href') || '',
    tech,
    html: descHtml,
    text: tmp.textContent.replace(/\s+/g, ' ').trim(),
  };
}

function listItems(s) {
  const ul = s.nodes.find((n) => n.tagName === 'UL' || n.tagName === 'OL');
  const nodes = ul ? [...ul.children] : s.nodes.filter((n) => n.tagName === 'P');
  if (!nodes.length) throw new Error('no list items or paragraphs');
  return nodes.map((n) => ({ html: n.innerHTML, text: n.textContent.replace(/\s+/g, ' ').trim() }));
}

// ---------------------------------------------------------------------------
// Derived helpers used by views + the answer engine
// ---------------------------------------------------------------------------

/** All spellings a skill can be referred to by. "C / C++" -> C, C++. */
export function skillVariants(skill) {
  const out = new Set(tokenizeSkill(skill));
  skill.split(/\s+\/\s+/).forEach((v) => out.add(v.trim()));
  return [...out].filter(Boolean);
}

/** "12+ years" straight from the summary, if stated. */
export function statedYears(model) {
  const m = model.summary?.text.match(/(\d+\+?)\s*years/i);
  return m ? `${m[1]} years` : '';
}

export function careerStart(model) {
  const starts = model.jobs.map((j) => j.range?.start).filter(Boolean);
  if (!starts.length) return null;
  return starts.reduce((a, b) => (a.y * 12 + a.m <= b.y * 12 + b.m ? a : b));
}

export const currentJob = (model) => model.jobs.find((j) => j.range?.current) || model.jobs[0] || null;
