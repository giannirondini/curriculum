// Free-text question answering, with no LLM involved.
//
//   question -> norm() -> small-talk / meta rules
//            -> intent rules (contact, education, current role, year, company…)
//            -> entity extraction (skills, projects, categories from cv.md)
//            -> BM25 retrieval over CV chunks
//            -> honest "not in the CV" fallback (+ related / typo hints)
//
// Every answer is rendered by views.js from the parsed model, so nothing can
// be said that isn't in cv.md (apart from the deliberate small-talk lines).

import { html, raw, run, ext, norm, pick } from './util.js';
import { expandQuery, snippet, STOP, terms } from './search.js';

const R = {
  greet: /^(hi|hello|hey|hiya|howdy|ciao|hola|salut|bonjour|buongiorno|yo|sup|good (morning|afternoon|evening))( there| gianni| everyone| all)?$/,
  thanks: /^(ok |okay )?(thanks|thank you|thx|ty|grazie|merci|cheers|great|cool|nice|awesome|perfect)( (a lot|so much|very much|again))?$/,
  injection: /\b(ignore|disregard|forget) (all |any |your |the |previous |prior |above |earlier )*(instructions|prompts?|rules)\b|\bsystem prompt\b|\bjailbreak\b|\bdeveloper mode\b|\bdan mode\b|\bpretend (you are|to be)\b/,
  meta: /\b(are|r) (you|u) (an? )?(ai|bot|robot|llm|gpt|chatgpt|claude|copilot|human|real|sentient|alive|conscious|person|machine)\b|\b(which|what) (model|llm)\b|\bwho are you\b|\bwhat are you\b|\bwho am i (talking|speaking) to\b/,
  howBuilt: /\bhow (does|do|did) (this|it|you) (work|built|made)\b|\bhow (was|is) (this|it) (built|made|done)\b|\bsource code\b|\bbuilt with\b|\bunder the hood\b|\bhow are you (built|made)\b|\bwhat powers\b/,
  life: /\bmeaning of life\b|\banswer to (life|everything)\b/,
  joke: /\b(joke|jokes|make me laugh|something funny)\b/,
  contact: /\b(contact|e ?mail|reach (him|gianni|you|out)|get in touch|phone|call (him|gianni)|linkedin|twitter|socials?)\b/,
  pdf: /\b(pdf|download|printable|print|resume file|cv file)\b/,
  availability: /\b(available|availability|open to (work|new|offers?|opportunit\w*|roles?)|looking for (a )?(new )?(job|role|position|opportunit\w*)|notice period|start date|when can (he|gianni|you) start|job hunting)\b/,
  salary: /\b(salary|salaries|compensation|pay|paid|money|rates|day rate|salary expectations?|earn|earns)\b/,
  location: /\b(live|lives|living|based|located|location|relocat\w*|remote|hybrid|onsite|on site|visa|work permit|citizenship|citizen|nationality|timezone|time zone|country|city)\b|\bwhere is (he|gianni) from\b/,
  spoken: /\b(speak|speaks|spoken|fluent|fluency|native language|mother tongue)\b/,
  languageWord: /\blanguages?\b/,
  programming: /\b(programming|coding|code|tech|technical|software|computer)\b/,
  education: /\b(degree|degrees|study|studied|studies|university|universities|college|school|education|educated|master|masters|bachelor|bachelors|msc|bsc|phd|politecnico|graduat\w*|academic|diploma)\b/,
  certs: /\b(certif\w*|certificates?|accreditations?|psm|credentials?)\b/,
  publications: /\b(publications?|published|papers?|research|articles?)\b/,
  mcp: /\bmcp\b|\bmodel context protocol\b/,
  projects: /\b(projects?|open source|side projects?|repos?|repositories|portfolio|built|hobby|hobbies|personal work)\b/,
  current: /\b(currently|current|right now|nowadays|these days|today|at the moment|presently)\b|\bnow\b|\bwhere (does|do) (he|gianni|you) work\b|\bwhat (does|do) (he|gianni|you) do\b|\bworking on\b|\bwho (does|do) (he|gianni|you) work for\b|\bjob title\b|\bwhat is (his|gianni s|your) (job|role|position)\b/,
  yearsExp: /\bhow (many|much) years\b|\bhow long\b|\byears of experience\b|\bseniority\b|\bhow (senior|experienced)\b|\bexperience level\b/,
  timeline: /\b(career|timeline|work history|employment|employers|companies|previous (jobs|roles|employers|companies)|past (jobs|roles)|work experience|professional experience|job history|all (jobs|roles))\b|\bwhere (did|has|have) (he|gianni|you) work(ed)?\b|\bworked (at|for)\b/,
  pitch: /\bwhy (should|would|do|to) ((we|i|you|anyone|someone|one) )?hire\b|\bwhy hire\b|\bstrengths?\b|\bwhat makes (him|gianni)\b|\bunique\b|\bsell me\b|\bpitch\b|\bstand out\b|\bgood fit\b|\bconvince me\b|\bbest at\b/,
  about: /\bwho is\b|\btell me (more )?about (him|gianni|yourself|gianni rondini)\b|\babout (him|gianni)\b|\bsummary\b|\bintroduc\w*\b|\bbackground\b|\bprofile\b|\boverview\b|\bbio\b|\bwho s gianni\b/,
  impact: /\b(achievements?|accomplishments?|impact|proud\w*|results|metrics|biggest wins?|track record|highlights?)\b/,
  skillsAny: /\b(skills?|skillset|stack|tech stack|tech|technolog\w*|tools?|competenc\w*|expertise|good at|strongest|specialt\w*|speciali[sz]\w*|toolbox)\b/,
  techAsk: /\b(?:know|knows|use|uses|used|using|experience (?:with|in)|expertise (?:in|with)|familiar with|worked with|work with|proficient (?:in|with)|skilled (?:in|with)|expert (?:in|with)|good (?:at|with)|code in|program in)\s+(.{2,40})$/,
  year: /\b(19[5-9]\d|20[0-4]\d)\b/,
};

const LANGS = ['italian', 'english', 'french', 'spanish', 'german', 'portuguese', 'dutch', 'chinese', 'mandarin',
  'japanese', 'russian', 'arabic', 'hindi', 'korean', 'polish', 'swedish', 'greek', 'turkish', 'romanian', 'catalan'];

const JOKES = [
  'Why do Java developers wear glasses? Because they can’t C#.',
  'A SQL query walks into a bar, walks up to two tables and asks: “Can I join you?”',
  'I’d tell you a UDP joke, but you might not get it.',
  'There are only two hard things in computer science: cache invalidation, naming things, and off-by-one errors.',
  'Knock knock. Race condition. Who’s there?',
];

const FILLER = /\b(at all|before|professionally|in production|too|as well|also|yet|ever|please|thanks?)\b/g;

export function createAnswerer({ model, facts, views, index, repoUrl }) {
  const first = model.name.split(' ')[0];

  const say = (intent, detail, view) => ({ intent, detail, ...view });
  const p = (...parts) => html`<p class="o-p">${parts}</p>`;
  const tip = (...parts) => html`<p class="o-tip">${parts}</p>`;

  const examples = () => {
    const ex = [`What is ${first} working on now?`];
    const top = views.examples.topStack;
    if (top) ex.push(`Experience with ${top}?`);
    if (views.examples.exampleYear) ex.push(`What did ${first} do in ${views.examples.exampleYear}?`);
    if (views.examples.exampleCompany) ex.push(`Tell me about ${views.examples.exampleCompany[0].toUpperCase()}${views.examples.exampleCompany.slice(1)}`);
    ex.push(`Why should we hire ${first}?`);
    if (model.languages[1]) ex.push(`Does ${first} speak ${model.languages[model.languages.length - 1].label}?`);
    return ex;
  };

  // ---- retrieval ----------------------------------------------------------
  function retrieve(text, { max = 5, perRef = 2 } = {}) {
    const { base, weights } = expandQuery(text);
    if (!base.length) return { base, hits: [] };
    const raw = index.search(weights, 30);
    if (!raw.length) return { base, hits: [] };
    const top = raw[0];
    const baseSet = new Set(base);
    const strong = [...top.matched].some((t) => baseSet.has(t)) ? top.score >= 1.2 : top.score >= 2.5;
    if (!strong) return { base, hits: [] };
    const perRefCount = new Map();
    const hits = [];
    for (const h of raw) {
      if (h.score < top.score * 0.4 || hits.length >= max) break;
      const n = perRefCount.get(h.doc.ref) || 0;
      if (n >= perRef) continue;
      perRefCount.set(h.doc.ref, n + 1);
      hits.push(h);
    }
    const stems = new Set(hits.flatMap((h) => [...h.matched]));
    hits.forEach((h) => (h.snippetHtml = snippet(h.doc.text, stems)));
    return { base, hits };
  }

  /** The visitor's own content words ("pricing cockpit"), for display. */
  const topicOf = (text) =>
    text
      .split(/\s+/)
      .filter((w) => {
        const n = norm(w);
        return n && n.split(' ').some((x) => !STOP.has(x));
      })
      .join(' ')
      .replace(/[?!.,;:]+$/, '') || text;

  function retrievalAnswer(input, hits) {
    const topic = topicOf(input);
    return say('search', `bm25("${topic}") → ${hits.length} hits / ${index.docs.length} chunks`, views.results(hits, topic));
  }

  /**
   * "migration projects", "skills in api design": a list keyword plus other
   * content words. If the other words retrieve something, answer that instead
   * of dumping the whole list.
   */
  function narrowed(q, trigger) {
    const rest = q.replace(new RegExp(trigger.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
    if (!rest || !terms(rest).length) return null;
    const { hits } = retrieve(rest);
    return hits.length ? retrievalAnswer(rest, hits) : null;
  }

  // ---- canned, CV-aware answers -------------------------------------------------
  function contactLine() {
    const email = model.contacts.find((c) => c.kind === 'email');
    return email ? html`<a href="${email.href}">${email.label}</a>` : run('/contact');
  }

  function notStated(topics) {
    const nat = model.contacts.find((c) => c.kind === 'nationality');
    return {
      html: html`${p(`The CV doesn't cover ${topics}. That's a question for ${first} directly: `, contactLine(), '.')}
        ${nat && /where|based|location|relocat|remote|visa|nationality/.test(topics) ? p(html`What it does say: ${nat.icon} ${nat.label}.`) : ''}`,
      suggest: ['/contact', '/pdf', '/about'],
    };
  }

  function spoken(q) {
    const known = model.languages;
    const asked = LANGS.find((l) => new RegExp(`\\b${l}\\b`).test(q));
    if (!known.length) return views.generic(model.sections.find((s) => s.command === 'languages'));
    const listHtml = html`<dl class="o-kv">${known.map((l) => html`<dt>${l.icon ? html`<span aria-hidden="true">${l.icon}</span> ` : ''}${l.label}</dt><dd>${l.level}</dd>`)}</dl>`;
    if (asked) {
      const hit = known.find((l) => norm(l.label).includes(asked));
      return {
        html: hit
          ? p(html`<span class="o-ok">✓</span> Yes: <strong>${hit.label}</strong>, ${hit.level.charAt(0).toLowerCase() + hit.level.slice(1)}.`)
          : html`${p(html`<span class="o-warn">✗</span> ${asked[0].toUpperCase() + asked.slice(1)} isn't listed. Languages in the CV:`)}${listHtml}`,
        suggest: ['/languages', '/education'],
      };
    }
    const progCat = facts.categoryByKey('languages');
    return {
      html: html`${p('Spoken languages:')}${listHtml}${progCat ? tip('Programming languages: ', run(`/skills ${progCat.key}`), '.') : ''}`,
      suggest: ['/languages', progCat ? `/skills ${progCat.key}` : '/skills'],
    };
  }

  function impact() {
    const rx = /\d|%|\breduc|\bincreas|\bunblock|\bscal|\benabl|\btransform|\bmoderniz|\bestablish|\bstandardiz|\bled\b|\barchitected/gi;
    const scored = model.jobs.flatMap((j) =>
      j.bullets.map((b) => {
        const t = b.text.replace(/\((?:19|20)\d{2}[^)]*\)/g, ''); // "(2018–2019)" is not a metric
        return { j, b, s: (t.match(rx) || []).length + (/\d|%/.test(t) ? 2 : 0) };
      }),
    );
    const top = scored.sort((a, b) => b.s - a.s || a.j.n - b.j.n).slice(0, 4);
    return {
      html: html`${p('A few results with measurable or org-wide impact:')}
        <div class="o-hits">${top.map(
          ({ j, b }) => html`<div class="o-hit"><div class="o-hit__src">${views.ref(views.jobCmd(j), `${j.title} · ${j.company}`)}</div><p class="o-hit__text">${raw(b.html)}</p></div>`,
        )}</div>
        ${tip('Everything else: ', run('/experience'))}`,
      suggest: [...new Set(top.map(({ j }) => views.jobCmd(j)))].slice(0, 3).concat('/about'),
    };
  }

  function categoryAnswer(cat, input) {
    const v = views.category(cat);
    const { hits } = retrieve(input, { max: 3, perRef: 1 });
    const evidence = hits.filter((h) => !h.doc.id.startsWith('cat-'));
    return {
      html: html`${v.html}${evidence.length
        ? html`<p class="o-p o-muted">Evidence from the experience section:</p><div class="o-hits">${evidence.map(
            (h) => html`<div class="o-hit"><div class="o-hit__src">${views.ref(h.doc.ref, h.doc.label)}</div><p class="o-hit__text">${raw(h.snippetHtml)}</p></div>`,
          )}</div>`
        : ''}`,
      suggest: v.suggest,
    };
  }

  function smallTalk(q) {
    if (R.injection.test(q)) {
      return say('prompt_injection', 'nice try', {
        html: html`${p('Nice try. 😄 There is no system prompt to leak and no instructions to ignore: just a few hundred lines of JavaScript doing intent matching and BM25 over cv.md.')}
          ${tip(`Spotting prompt injection is part of the job, though. ${first} builds AI developer tooling: `, run('/skills ai'), ' · ', run('/mcp'))}`,
        suggest: ['/skills ai', '/mcp'],
      });
    }
    if (R.greet.test(q)) {
      return say('greeting', 'small talk', {
        html: html`${p(`Hi! 👋 I answer questions about ${first}'s CV, offline. Try one of these:`)}
          <ul class="o-asks">${examples().slice(0, 4).map((e) => html`<li>${run(e, html`<span aria-hidden="true">›</span> ${e}`, 'o-ask')}</li>`)}</ul>`,
        suggest: examples().slice(0, 3).concat('/help'),
      });
    }
    if (R.thanks.test(q)) return say('thanks', 'small talk', { html: p('Anytime. Tokens billed: 0. 🙂'), suggest: ['/contact', '/pdf'] });
    if (R.life.test(q)) return say('easter_egg', '42', { html: p('42. It isn’t in the CV, but some facts are universal.') });
    if (R.joke.test(q)) return say('easter_egg', 'joke', { html: html`${p(pick(JOKES))}${tip('Not in the CV either. Back to business: ', run('/experience'))}` });
    if (R.howBuilt.test(q)) {
      return say('meta', 'how this works', {
        html: html`${p(`This page fetches cv.md, the same file behind the classic site, parses it with marked, then builds a structured model and a BM25 index in your browser. Questions go through hand-written intent rules first and full-text retrieval second. No framework, no build step, no backend, no LLM.`)}
          ${repoUrl ? tip('Source: ', ext(repoUrl, repoUrl.replace(/^https?:\/\//, '')), ' · try ', run('/doctor')) : ''}`,
        suggest: ['/doctor', '/model', '/classic'],
      });
    }
    if (R.meta.test(q)) {
      return say('meta', 'identity', {
        html: html`${p(html`No LLM here. I'm <strong>cv-retriever-1</strong>: intent rules + BM25 search over cv.md, running entirely in your browser. Every answer comes from the CV, so I can't hallucinate. I can only fail to find things.`)}
          ${tip(`For the real AI work, see what ${first} builds: `, run('/mcp'), ' · ', run('/skills ai'))}`,
        suggest: ['/mcp', '/skills ai', '/model'],
      });
    }
    return null;
  }

  // ---- router ---------------------------------------------------------------
  function route(input) {
    const q = norm(input);
    if (!q) return say('empty', 'nothing to parse', { html: p(html`I only speak text. Try ${run('/help')}.`) });

    const talk = smallTalk(q);
    if (talk) return talk;

    const ents = facts.entities(q);

    if (R.contact.test(q)) return say('contact', 'contacts', views.contact());
    if (R.pdf.test(q)) {
      return say('pdf', 'download', { html: p(html`The PDF version is one command away: ${run('/pdf')}.`), suggest: ['/pdf', '/contact'] });
    }
    const unstated = [
      R.salary.test(q) && 'compensation',
      R.availability.test(q) && 'availability or notice period',
      R.location.test(q) && `where ${first} is based, or remote/relocation preferences`,
    ].filter(Boolean);
    if (unstated.length) return say('not_stated', unstated.join(' + '), notStated(unstated.join(', or ')));

    if (R.spoken.test(q) || (R.languageWord.test(q) && !R.programming.test(q) && !ents.length)) {
      return say('languages', 'spoken', spoken(q));
    }
    if (R.languageWord.test(q) && R.programming.test(q)) {
      const cat = facts.categoryByKey('languages');
      if (cat) return say('skills_category', cat.name, views.category(cat));
    }
    if (R.education.test(q)) return say('education', 'section', views.education());
    if (R.certs.test(q)) return say('certifications', 'section', views.certifications());
    if (R.publications.test(q)) return say('publications', 'section', views.publications());
    if (R.mcp.test(q)) return say('mcp', 'servers built', views.mcp());

    const proj = facts.projectIn(q);
    if (proj) return say('project', proj.slug, views.project(proj));

    const year = q.match(R.year);
    if (year) return say('year', year[1], views.inYear(+year[1]));

    const company = facts.companyIn(q);
    if (company && !ents.length) {
      const v = views.company(company);
      if (v) return say('company', company, v);
    }

    if (R.yearsExp.test(q) && !ents.length) return say('years_of_experience', 'summary + dates', views.years());
    if (R.current.test(q) && !ents.length) return say('current_role', `experience[1]`, views.now());
    if (R.timeline.test(q) && !ents.length) return narrowed(q, R.timeline) || say('timeline', 'experience', views.experience());
    if (R.pitch.test(q)) return say('pitch', 'summary + current role', views.pitch());
    if (R.about.test(q) && !ents.length) return say('about', 'summary', views.about());
    if (R.impact.test(q)) return say('impact', 'ranked bullets', impact());

    if (ents.length) {
      const results = ents.slice(0, 3).map((e) => facts.lookup(e)).filter((r) => r.found);
      if (results.length === 1) {
        return say('skill_lookup', `"${results[0].display}" → ${results[0].jobs.length} roles, ${results[0].projects.length} projects`, views.skill(results[0]));
      }
      if (results.length > 1) {
        const vs = results.map((r) => views.skill(r));
        return say('skill_lookup', results.map((r) => `"${r.display}"`).join(' + '), {
          html: html`${vs.map((v) => v.html)}`,
          suggest: [...new Set(vs.flatMap((v) => v.suggest))].slice(0, 5),
        });
      }
    }

    const cats = facts.categoryIn(q);
    if (cats.length) return say('skills_category', cats[0].name, categoryAnswer(cats[0], input));
    if (R.skillsAny.test(q)) return narrowed(q, R.skillsAny) || say('skills', 'overview', views.skills());
    if (R.projects.test(q)) return narrowed(q, R.projects) || say('projects', 'list', views.projects());

    // "does he know react?" where react isn't in the CV: retrieval first (it
    // may still be described in prose), then an honest "not in the CV".
    const ask = q.match(R.techAsk);
    if (ask) {
      const thing = ask[1].replace(FILLER, ' ').replace(/^(the|a|an|any|some)\s+/, '').trim();
      const words = thing.split(' ').filter(Boolean);
      if (words.length && words.length <= 3 && !words.some((w) => ['how', 'what', 'to', 'when', 'where', 'why', 'who'].includes(w))) {
        const { hits } = retrieve(thing);
        if (hits.length) return retrievalAnswer(thing, hits);
        const related = [...new Set([...facts.related(thing.replace(/ /g, '')), ...facts.related(words[0])])];
        return say('not_in_cv', `"${thing}"`, views.notInCv(thing, related, facts.closest(words[0])));
      }
    }

    const { hits } = retrieve(input);
    if (hits.length) return retrievalAnswer(input, hits);

    // Nothing matched: maybe a tech that isn't in the CV, or a typo.
    for (const w of q.split(' ').filter((x) => x.length > 1 && !STOP.has(x))) {
      const related = facts.related(w);
      const typos = facts.closest(w);
      if (related.length || typos.length) return say('not_in_cv', `"${w}"`, views.notInCv(w, related, typos));
    }

    return say('fallback', `bm25 → 0 hits / ${index.docs.length} chunks`, {
      html: html`${p(`I couldn't find anything about that in the CV. I'm an offline retriever, not an LLM, so I only know what's written in cv.md.`)}
        <ul class="o-asks">${examples().slice(0, 3).map((e) => html`<li>${run(e, html`<span aria-hidden="true">›</span> ${e}`, 'o-ask')}</li>`)}</ul>
        ${tip('Or browse: ', run('/help'))}`,
      suggest: ['/help', ...examples().slice(0, 2)],
    });
  }

  function answer(input) {
    const t0 = performance.now();
    const r = route(input);
    r.ms = performance.now() - t0;
    return r;
  }

  return { answer, examples };
}
