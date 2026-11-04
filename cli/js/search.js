// Retrieval fallback for free-text questions: BM25 over small CV chunks
// (one per bullet / project / summary line…), plus a light stemmer and a
// small query-side synonym map. No embeddings, no network, ~1 ms per query.

import { norm, esc } from './util.js';

export const STOP = new Set(
  `a an the and or but of to in on at for with by from as is are was were be been being do does did
  done has have had having i me my mine you your yours he him his she her hers they them their it its
  this that these those what which who whom whose when where why how can could would should will shall
  may might must about tell show give list any some much many more most other into over under than then
  there here also just very really please s t ve ll d re m let lets let's want wanted like would kind sort
  gianni rondini know knows known experience experienced work worked working works skill skills use
  used using uses familiar tell anything something thing things info information question questions
  ever before still yet all only own done get got make made thanks hi hello hey ok okay`.split(/\s+/),
);

const IRREGULAR = {
  led: 'lead', leader: 'lead', leadership: 'lead', leading: 'lead', built: 'build', ran: 'run',
  wrote: 'write', written: 'write', taught: 'teach', better: 'good', best: 'good',
  apis: 'api', llms: 'llm', ais: 'ai', mentorship: 'mentor', ownership: 'own', owner: 'own',
};

// Deliberately crude: index and query go through the same function, so it
// only needs to be consistent (migration / migrated / migrate -> "migrat").
export function stem(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  let t = w;
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(ss|x|ch|sh)es$/.test(t)) t = t.slice(0, -2);
  else if (t.endsWith('s') && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (t.endsWith('ization') && t.length > 8) t = t.slice(0, -5); // optimization -> optimiz
  else if (t.endsWith('ation') && t.length > 7) t = t.slice(0, -3); // migration -> migrat
  else if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ed') && t.length > 4) t = t.slice(0, -2);
  if (t.endsWith('e') && t.length > 4) t = t.slice(0, -1); // optimize -> optimiz, migrate -> migrat
  return IRREGULAR[t] || t;
}

export const terms = (text) =>
  norm(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem);

// Query expansion (query side only). Values are plain words; they get stemmed.
const SYNONYMS = {
  ai: 'genai llm copilot claude mcp agent prompt ollama',
  genai: 'ai llm copilot claude agent',
  llm: 'ollama lm studio genai ai',
  agent: 'agents mcp copilot',
  frontend: 'angular typescript rxjs ngrx ui javascript',
  ui: 'frontend angular ux',
  ux: 'ui design',
  backend: 'java quarkus spring hibernate api',
  cloud: 'azure openshift docker',
  devops: 'jenkins argocd pipelines cicd github actions',
  cicd: 'pipelines jenkins argocd',
  pipeline: 'cicd jenkins',
  lead: 'leadership owner mentored scrum master roadmap',
  leadership: 'led lead mentored mentorship owner',
  manage: 'lead leadership owner',
  management: 'lead leadership owner',
  mentor: 'mentorship mentored',
  mentoring: 'mentorship mentored',
  coach: 'mentored mentorship',
  agile: 'scrum safe',
  scrum: 'agile safe',
  api: 'openapi gateway governance apim',
  monitoring: 'observability splunk datadog',
  observability: 'splunk datadog monitoring',
  database: 'oracle couchbase sql',
  db: 'oracle couchbase sql',
  performance: 'latency tuning',
  speed: 'performance latency',
  latency: 'performance',
  migration: 'migrated modernization migrate',
  modernization: 'migration redesign',
  hospitality: 'hotel ihotelier travelclick',
  hotel: 'hospitality ihotelier',
  airline: 'ndc offer pricing',
  travel: 'cytric amadeus airline hospitality',
  health: 'hospital ministry aifa',
  healthcare: 'health hospital aifa',
  research: 'publication',
  paper: 'publication',
  mobile: 'macos swift',
  apple: 'macos swift',
  documentation: 'confluence playbooks docs',
  docs: 'documentation confluence',
  standards: 'governance standardization',
  automation: 'automate scripts',
  testing: 'qa sonarqube',
  quality: 'sonarqube qa',
  security: 'privacy',
  privacy: 'local offline',
};

export function expandQuery(text) {
  const base = terms(text);
  const weights = new Map();
  base.forEach((t) => weights.set(t, 1));
  base.forEach((t) => {
    const syn = SYNONYMS[t];
    if (!syn) return;
    syn.split(' ').map(stem).forEach((s) => {
      if (!weights.has(s)) weights.set(s, 0.45);
    });
  });
  return { base, weights };
}

// ---------------------------------------------------------------------------

export function buildDocs(model) {
  const docs = [];
  const add = (d) => docs.push(d);

  model.summary?.paragraphs.forEach((p, i) => {
    const t = document.createElement('div');
    t.innerHTML = p;
    add({ id: `sum-${i}`, label: 'Summary', ref: '/about', text: t.textContent.trim() });
  });
  model.summary?.highlights.forEach((h, i) =>
    add({ id: `hl-${i}`, label: `Summary · ${h.title}`, ref: '/about', text: `${h.title} — ${h.text}` }),
  );

  model.skills.forEach((c) =>
    add({ id: `cat-${c.key}`, label: `Skills · ${c.name}`, ref: `/skills ${c.key}`, text: `${c.name}: ${c.skills.join(' · ')}` }),
  );

  model.jobs.forEach((j) => {
    const ctx = `${j.title} ${j.company} ${j.team}`;
    const label = `${j.title} · ${j.company}`;
    const ref = `/experience ${j.n}`;
    add({ id: `job-${j.n}`, label, ref, ctx, text: [j.title, j.company, j.team, j.dates, j.descriptor].filter(Boolean).join(' · ') });
    j.bullets.forEach((b, i) => add({ id: `job-${j.n}-${i}`, label, ref, ctx, text: b.text }));
    if (j.stack.length) add({ id: `job-${j.n}-stack`, label, ref, ctx, text: `Stack: ${j.stack.join(' · ')}` });
  });

  model.projects.forEach((p) =>
    add({ id: `prj-${p.slug}`, label: `Project · ${p.name}`, ref: `/projects ${p.slug}`, text: `${p.name} — ${p.tech.join(' · ')} — ${p.text}` }),
  );
  model.projectsNotes.forEach((n, i) => add({ id: `prj-note-${i}`, label: 'Projects', ref: '/projects', text: n.text }));
  model.education.forEach((e, i) => add({ id: `edu-${i}`, label: 'Education', ref: '/education', text: e.text }));
  model.certifications.forEach((c, i) => add({ id: `cert-${i}`, label: 'Certifications', ref: '/certifications', text: c.text }));
  model.languages.forEach((l, i) => add({ id: `lang-${i}`, label: 'Languages', ref: '/languages', text: `${l.label}: ${l.level}` }));
  model.publications.forEach((p, i) => add({ id: `pub-${i}`, label: 'Publications', ref: '/publications', text: p.text }));

  model.sections
    .filter((s) => s.kind === 'generic')
    .forEach((s) =>
      s.text.split('\n').filter(Boolean).forEach((line, i) =>
        add({ id: `gen-${s.id}-${i}`, label: s.title, ref: `/${s.command}`, text: line }),
      ),
    );

  return docs;
}

export class Bm25 {
  constructor(docs, { k1 = 1.2, b = 0.75, ctxWeight = 0.35 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = docs;
    this.df = new Map();
    let total = 0;
    docs.forEach((d) => {
      const tf = new Map();
      terms(d.text).forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      // Job context (title/company) counts a little, so "API work at Cytric" can
      // prefer Cytric bullets without every bullet repeating the company name.
      if (d.ctx) terms(d.ctx).forEach((t) => tf.set(t, (tf.get(t) || 0) + ctxWeight));
      d.tf = tf;
      d.len = [...tf.values()].reduce((a, v) => a + v, 0);
      total += d.len;
      tf.forEach((_, t) => this.df.set(t, (this.df.get(t) || 0) + 1));
    });
    this.avgdl = total / Math.max(1, docs.length);
    this.vocabulary = this.df.size;
  }

  idf(t) {
    const n = this.df.get(t) || 0;
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  search(weights, limit = 6) {
    const { k1, b, avgdl } = this;
    const hits = [];
    for (const d of this.docs) {
      let score = 0;
      const matched = new Set();
      weights.forEach((w, t) => {
        const f = d.tf.get(t);
        if (!f) return;
        score += w * this.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgdl)));
        matched.add(t);
      });
      if (score > 0) hits.push({ doc: d, score, matched });
    }
    hits.sort((x, y) => y.score - x.score);
    return hits.slice(0, limit);
  }
}

/**
 * Escaped snippet with matched words wrapped in <mark>. Long texts are
 * windowed around the first match.
 */
export function snippet(text, stems, max = 260) {
  let start = 0;
  let end = text.length;
  if (text.length > max) {
    const first = [...text.matchAll(/[\p{L}\p{N}+#.]+/gu)].find((m) => stems.has(stem(norm(m[0]))));
    const pos = first ? first.index : 0;
    start = Math.max(0, pos - 90);
    end = Math.min(text.length, start + max);
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
  }
  const slice = text.slice(start, end);
  let out = '';
  let last = 0;
  for (const m of slice.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = norm(m[0]);
    if (w && stems.has(stem(w))) {
      out += esc(slice.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
  }
  out += esc(slice.slice(last));
  return `${start > 0 ? '…' : ''}${out}${end < text.length ? '…' : ''}`;
}
