// Knowledge queries over the model: "where is skill X used?", entity
// extraction for free-text questions, related-tech hints for things that are
// NOT in the CV. Everything is derived from cv.md at load time.

import { chipMatchesTokens, tokenizeSkill } from '../../shared/skill-match.js';
import { norm, hasPhrase, months, levenshtein } from './util.js';
import { skillVariants } from './model.js';

// Skill spellings that are also everyday English words: never auto-detected
// in free text (still work via /skills <name>).
const GENERIC = new Set(['functions', 'i']);

// Common shorthands -> vocabulary phrase (only applied if the target exists).
const ALIASES = {
  js: 'javascript', ts: 'typescript', py: 'python', node: 'nodejs',
  copilot: 'github copilot', claude: 'claude code', gha: 'github actions',
  'gh actions': 'github actions', 'spring boot': 'spring', springboot: 'spring',
  llm: 'local llm deployment', llms: 'local llm deployment', 'local llms': 'local llm deployment',
  'api management': 'azure api management', 'event driven': 'event driven architecture',
};

// Not in the CV? Point at what is. Values are resolved against the
// vocabulary, so anything missing from cv.md is silently dropped.
const RELATED = {
  kubernetes: ['OpenShift', 'Docker', 'ArgoCD'],
  k8s: ['OpenShift', 'Docker', 'ArgoCD'],
  helm: ['OpenShift', 'ArgoCD'],
  react: ['Angular', 'TypeScript', 'RxJS'],
  vue: ['Angular', 'TypeScript'],
  svelte: ['Angular', 'TypeScript'],
  nextjs: ['Angular', 'TypeScript', 'Node.js'],
  aws: ['Azure (Databricks, Functions, CDN, APIM)', 'Docker', 'OpenShift'],
  gcp: ['Azure (Databricks, Functions, CDN, APIM)', 'Docker', 'OpenShift'],
  terraform: ['Azure (Databricks, Functions, CDN, APIM)', 'GitHub Actions', 'Jenkins'],
  ansible: ['Docker', 'Jenkins', 'Bash'],
  kotlin: ['Java', 'Groovy'],
  scala: ['Java'],
  go: ['Java', 'Python'],
  golang: ['Java', 'Python'],
  rust: ['C / C++', 'Swift'],
  csharp: ['Java', 'TypeScript'],
  dotnet: ['Java', 'Spring', 'Quarkus'],
  php: ['Java', 'TypeScript', 'Python'],
  ruby: ['Python', 'Bash'],
  postgres: ['Oracle DB', 'CouchBase', 'SQL'],
  postgresql: ['Oracle DB', 'CouchBase', 'SQL'],
  mysql: ['Oracle DB', 'SQL'],
  mongodb: ['CouchBase'],
  redis: ['CouchBase'],
  kafka: ['Event-driven architecture', 'Microservices'],
  rabbitmq: ['Event-driven architecture', 'Microservices'],
  gitlab: ['GitHub Actions', 'Jenkins', 'ArgoCD'],
  openai: ['GitHub Copilot customization', 'Claude Code', 'Ollama', 'MCP (Model Context Protocol)'],
  chatgpt: ['GitHub Copilot customization', 'Claude Code', 'Ollama'],
  gpt: ['GitHub Copilot customization', 'Claude Code', 'Ollama'],
  gemini: ['GitHub Copilot customization', 'Claude Code', 'Ollama'],
  langchain: ['MCP (Model Context Protocol)', 'Custom agents', 'Python'],
  rag: ['Context engineering', 'Prompt engineering', 'MCP (Model Context Protocol)'],
  pytorch: ['Python', 'Local LLM deployment'],
  tensorflow: ['Python', 'Local LLM deployment'],
  ios: ['Swift'],
  grafana: ['Datadog', 'Splunk'],
  prometheus: ['Datadog', 'Splunk'],
  elastic: ['Splunk', 'Datadog'],
  graphql: ['OpenAPI', 'API-first design'],
  grpc: ['OpenAPI', 'Microservices'],
  rest: ['OpenAPI', 'API-first design', 'API Governance'],
  linux: ['Bash', 'Docker'],
  testing: ['SonarQube'],
};

export function createFacts(model) {
  const summaryN = norm(model.summary?.text || '');
  const jobN = new Map(
    model.jobs.map((j) => [
      j,
      { bullets: j.bullets.map((b) => norm(b.text)), desc: norm(`${j.descriptor} ${j.intro.join(' ')}`), stack: j.stack.map(norm) },
    ]),
  );
  const projN = new Map(
    model.projects.map((p) => [p, { text: norm(p.text), tech: p.tech.map(norm), name: norm(p.name) }]),
  );

  /**
   * Where a Core Competencies skill shows up. Stack/tech chips use the same
   * fuzzy matcher as the classic site's category filter; bullets and project
   * descriptions use whole-word phrase mentions.
   */
  function usageOf(skill) {
    const tokens = new Set(tokenizeSkill(skill).map((t) => t.toLowerCase()));
    const variants = skillVariants(skill)
      .map(norm)
      .filter((v) => v.length > 1 && !GENERIC.has(v));
    const mentions = (n) => variants.some((v) => hasPhrase(n, v));
    const chip = (raw, n) => chipMatchesTokens(raw, tokens) || variants.some((v) => n === v);
    const jobs = model.jobs.filter((j) => {
      const n = jobN.get(j);
      return j.stack.some((st, i) => chip(st, n.stack[i])) || n.bullets.some(mentions) || mentions(n.desc);
    });
    const projects = model.projects.filter((p) => {
      const n = projN.get(p);
      return p.tech.some((t, i) => chip(t, n.tech[i])) || mentions(n.text);
    });
    return { jobs, projects, summary: mentions(summaryN) };
  }

  /** Free-form lookup of a normalized phrase ("java", "github copilot"). */
  function lookup(phrase) {
    const cats = [];
    model.skills.forEach((c) =>
      c.skills.forEach((s) => {
        const vs = skillVariants(s).map(norm);
        if (vs.some((v) => v === phrase || hasPhrase(v, phrase))) cats.push({ cat: c, skill: s });
      }),
    );
    const jobs = new Set(
      model.jobs.filter((j) => {
        const n = jobN.get(j);
        return n.stack.some((st) => hasPhrase(st, phrase)) || n.bullets.some((b) => hasPhrase(b, phrase)) || hasPhrase(n.desc, phrase);
      }),
    );
    const projects = new Set(
      model.projects.filter((p) => {
        const n = projN.get(p);
        return n.tech.some((t) => hasPhrase(t, phrase)) || hasPhrase(n.text, phrase) || hasPhrase(n.name, phrase);
      }),
    );
    // Exact Core Competencies skill ("C / C++", "Azure (…)")? Also apply the
    // classic site's chip semantics, which understand its variants.
    cats
      .filter((h) => skillVariants(h.skill).some((v) => norm(v) === phrase))
      .forEach((h) => {
        const u = usageOf(h.skill);
        u.jobs.forEach((j) => jobs.add(j));
        u.projects.forEach((p) => projects.add(p));
      });
    const jobList = [...jobs].sort((a, b) => a.n - b.n);
    const projList = model.projects.filter((p) => projects.has(p));
    const certs = model.certifications.filter((c) => hasPhrase(norm(c.text), phrase));
    const summary = hasPhrase(summaryN, phrase);
    // Display name: an exact spelling wins, Core Competencies first ("Node.js"
    // over "NodeJS", "SAFe" over "SAFe 5 Scrum Master"); otherwise the
    // shortest name that contains the phrase.
    const catNames = cats.flatMap((h) => skillVariants(h.skill));
    const chipNames = [...model.jobs.flatMap((j) => j.stack), ...model.projects.flatMap((p) => p.tech)];
    const exact = (list) => list.find((c) => norm(c) === phrase);
    const shortest = (list) => list.filter((c) => hasPhrase(norm(c), phrase)).sort((a, b) => a.length - b.length)[0];
    const display =
      exact(catNames) || exact(chipNames) || shortest([...catNames, ...chipNames]) || vocab.get(phrase) || phrase;
    const found = cats.length + jobList.length + projList.length + certs.length > 0 || summary;
    const span = jobList.reduce((acc, j) => acc + months(j.range), 0);
    return { phrase, display, cats, jobs: jobList, projects: projList, certs, summary, found, months: span };
  }

  // ---- vocabulary for entity extraction -----------------------------------
  const vocab = new Map(); // normalized phrase -> preferred display
  const addV = (s) => {
    const n = norm(s);
    if (n.length < 2 || GENERIC.has(n)) return;
    if (!vocab.has(n) || s.length < vocab.get(n).length) vocab.set(n, s);
  };
  model.skills.forEach((c) => c.skills.forEach((s) => skillVariants(s).forEach(addV)));
  model.jobs.forEach((j) => j.stack.forEach(addV));
  model.projects.forEach((p) => p.tech.forEach(addV));
  const phrases = [...vocab.keys()].sort(
    (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length,
  );

  /** Skill/tech phrases mentioned in a normalized query, longest first. */
  function entities(q) {
    let rest = ` ${q} `;
    const found = [];
    const take = (p, target = p) => {
      if (!rest.includes(` ${p} `)) return;
      found.push(target);
      rest = rest.split(` ${p} `).join(' ¶ ');
    };
    phrases.forEach((p) => take(p));
    Object.entries(ALIASES).forEach(([alias, target]) => {
      if (vocab.has(target)) take(alias, target);
    });
    return [...new Set(found)];
  }

  function related(word) {
    let key = RELATED[word] ? word : null;
    if (!key) {
      key = Object.keys(RELATED).find((k) => k.length > 3 && levenshtein(k, word) <= 1) || null;
    }
    const list = key ? RELATED[key] : [];
    return list.filter((d) => vocab.has(norm(d))).map((d) => vocab.get(norm(d)) || d);
  }

  /** Typo suggestions ("pyhton" -> Python). */
  function closest(word, max = 3) {
    if (word.length < 4) return [];
    return [...vocab.entries()]
      .map(([n, d]) => ({ d, dist: levenshtein(n, word) }))
      .filter((x) => x.dist > 0 && x.dist <= (word.length >= 5 ? 2 : 1))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, max)
      .map((x) => x.d);
  }

  /** Category mentioned by one of its distinctive words ("cloud", "devops"…). */
  function categoryIn(q) {
    return model.skills.filter((c) => c.words.some((w) => hasPhrase(q, w)));
  }

  function categoryByKey(arg) {
    const a = norm(arg);
    if (!a) return null;
    return (
      model.skills.find((c) => c.key === a.replace(/ /g, '-') || norm(c.name) === a) ||
      model.skills.find((c) => c.words.includes(a)) ||
      model.skills.find((c) => norm(c.name).startsWith(a)) ||
      null
    );
  }

  function project(arg) {
    const a = norm(arg);
    if (!a) return null;
    return (
      model.projects.find((p) => p.slug === arg || norm(p.slug) === a || norm(p.name) === a) ||
      model.projects.find((p) => norm(p.name).includes(a) || a.includes(norm(p.name))) ||
      null
    );
  }

  /** Project named in free text: full name, or a distinctive word of it. */
  function projectIn(q) {
    const common = new Set(['home', 'local', 'mcp', 'app', 'web', 'server', 'client', 'tool', 'cli', 'ai', 'code', 'the']);
    return (
      model.projects.find((p) => hasPhrase(q, norm(p.name))) ||
      model.projects.find((p) =>
        norm(p.name)
          .split(' ')
          .some((w) => w.length >= 4 && !common.has(w) && hasPhrase(q, w)),
      ) ||
      null
    );
  }

  const companies = [
    ...new Set(
      model.jobs.flatMap((j) => [j.company, j.contractorFor].filter(Boolean).map((c) => norm(c).split(' ')[0])),
    ),
  ].filter((c) => c.length > 2);

  function jobsAt(name) {
    return model.jobs.filter(
      (j) => hasPhrase(norm(j.company), name) || hasPhrase(norm(j.contractorFor), name),
    );
  }

  function companyIn(q) {
    return companies.find((c) => hasPhrase(q, c)) || null;
  }

  return {
    usageOf,
    lookup,
    entities,
    related,
    closest,
    categoryIn,
    categoryByKey,
    project,
    projectIn,
    companyIn,
    jobsAt,
    companies,
    vocab,
  };
}
