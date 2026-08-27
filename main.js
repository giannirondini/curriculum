// CV site bootstrap.
//
// Pipeline:
//   fetch cv.md
//     -> marked.parse              (Markdown -> raw HTML in detached fragment)
//     -> enrichment passes         (group sections, build job articles, chipify, etc.)
//     -> mark .is-offscreen        (pre-mount, so reveal anims have no FOUC)
//     -> mount into #cv
//     -> wire interactions         (nav, collapse, skills filter, theme, observers)

const CV_PATH = './cv.md';

const NAV_LABELS = {
  'professional-summary': 'Summary',
  'core-competencies': 'Skills',
  'professional-experience': 'Experience',
  'selected-open-source-side-projects': 'Projects',
  'education': 'Education',
  'certifications': 'Certifications',
  'languages': 'Languages',
  'publications': 'Publications',
};

const motionEnabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

bootstrap();

async function bootstrap() {
  const mount = document.getElementById('cv');
  if (!mount) return;

  // Theme runs immediately so the page doesn't flash light->dark on reload.
  initThemeToggle();

  try {
    const res = await fetch(CV_PATH, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to fetch ${CV_PATH}: ${res.status}`);
    const md = await res.text();

    if (typeof marked === 'undefined') throw new Error('marked parser not loaded');

    const rawHtml = marked.parse(md, { gfm: true, breaks: false });

    const frag = document.createElement('div');
    frag.innerHTML = rawHtml;

    splitHeader(frag);
    const sections = groupSections(frag);

    sections.forEach((section) => {
      try {
        if (section.id === 'professional-experience') enrichExperience(section);
        if (section.id === 'core-competencies') enrichSkills(section);
        if (section.id === 'selected-open-source-side-projects') enrichProjects(section);
        if (section.id === 'education') enrichEducation(section);
      } catch (e) {
        console.warn(`Enrichment failed for #${section.id}; falling back to plain HTML.`, e);
      }
    });

    if (motionEnabled) prepareReveal(sections);

    mount.innerHTML = '';
    sections.forEach((s) => mount.appendChild(s));
    mount.removeAttribute('aria-busy');

    buildNav(sections);
    initNavPriority();
    wireCollapse(mount);
    wireSkillsFilter(mount);
    initActiveSectionTracker();
    if (motionEnabled) initRevealObserver(mount);
  } catch (err) {
    mount.innerHTML = `<p class="cv__error">Could not load CV content. ${err.message}</p>`;
    mount.removeAttribute('aria-busy');
    console.error(err);
  }
}

// =====================================================================
// Helpers
// =====================================================================

function slug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// =====================================================================
// Enrichment passes
// =====================================================================

function splitHeader(frag) {
  const h1 = frag.querySelector('h1');
  if (!h1) return;

  const heroName = document.getElementById('heroName');
  const heroTitle = document.getElementById('heroTitle');
  const heroContacts = document.getElementById('heroContacts');

  if (heroName) heroName.textContent = h1.textContent.trim();

  const subtitle = h1.nextElementSibling;
  if (heroTitle && subtitle && subtitle.tagName === 'P') {
    const strong = subtitle.querySelector('strong');
    heroTitle.textContent = strong ? strong.textContent.trim() : subtitle.textContent.trim();
  }

  const contacts = subtitle?.nextElementSibling;
  if (heroContacts && contacts && contacts.tagName === 'P') {
    // Split "a · b · c" into pill spans; fall back to the raw line if there's
    // nothing to split.
    const parts = contacts.innerHTML.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
    heroContacts.innerHTML =
      parts.length > 1
        ? parts.map((p) => `<span class="hero__contact">${p}</span>`).join('')
        : contacts.innerHTML;
    heroContacts.querySelectorAll('a').forEach((a) => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
  }

  const hr = contacts?.nextElementSibling;
  h1.remove();
  subtitle?.remove();
  contacts?.remove();
  if (hr && hr.tagName === 'HR') hr.remove();
}

function groupSections(frag) {
  const sections = [];
  const h2s = [...frag.querySelectorAll('h2')];

  h2s.forEach((h2) => {
    const id = slug(h2.textContent);
    const section = document.createElement('section');
    section.id = id;
    section.dataset.section = id;

    h2.parentNode.insertBefore(section, h2);
    section.appendChild(h2);

    let next = section.nextSibling;
    while (next && !(next.nodeType === 1 && next.tagName === 'H2')) {
      const toMove = next;
      next = next.nextSibling;
      if (toMove.nodeType === 1 && toMove.tagName === 'HR') {
        toMove.remove();
      } else {
        section.appendChild(toMove);
      }
    }
    sections.push(section);
  });

  return sections;
}

function enrichExperience(section) {
  const h3s = [...section.querySelectorAll('h3')];

  h3s.forEach((h3, i) => {
    const expanded = i === 0;
    const bodyId = `job-${i}-body`;

    const article = document.createElement('article');
    article.className = 'job';
    article.setAttribute('aria-expanded', String(expanded));

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'job__header';
    header.setAttribute('aria-controls', bodyId);
    header.setAttribute('aria-expanded', String(expanded));

    const titleSpan = document.createElement('span');
    titleSpan.className = 'job__title';
    titleSpan.textContent = h3.textContent.trim();
    header.appendChild(titleSpan);

    const caret = document.createElement('span');
    caret.className = 'job__caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    header.appendChild(caret);

    h3.parentNode.insertBefore(article, h3);
    article.appendChild(header);

    const body = document.createElement('div');
    body.className = 'job__body';
    body.id = bodyId;
    article.appendChild(body);

    h3.remove();

    let next = article.nextSibling;
    while (next && !(next.nodeType === 1 && (next.tagName === 'H3' || next.tagName === 'H2'))) {
      const toMove = next;
      next = next.nextSibling;
      body.appendChild(toMove);
    }

    splitMetaLine(body);
    chipifyStack(body);
  });
}

function splitMetaLine(body) {
  const p = body.querySelector('p');
  if (!p) return;

  const strong = p.querySelector('strong');
  const em = p.querySelector('em');
  if (!strong) return;

  const company = strong.textContent.trim();
  const dates = em ? em.textContent.trim() : '';

  const clone = p.cloneNode(true);
  clone.querySelector('strong')?.remove();
  clone.querySelector('em')?.remove();
  const team = clone.textContent.replace(/[·\s]+/g, ' ').trim();

  const meta = document.createElement('p');
  meta.className = 'job__meta';

  const cSpan = document.createElement('span');
  cSpan.className = 'job__company';
  cSpan.textContent = company;
  meta.appendChild(cSpan);

  if (team) {
    const tSpan = document.createElement('span');
    tSpan.className = 'job__team';
    tSpan.textContent = team;
    meta.appendChild(tSpan);
  }

  if (dates) {
    const dSpan = document.createElement('span');
    dSpan.className = 'job__dates';
    dSpan.textContent = dates;
    meta.appendChild(dSpan);
  }

  p.replaceWith(meta);

  const desc = meta.nextElementSibling;
  if (desc && desc.tagName === 'P') {
    const onlyEm = desc.querySelector('em');
    if (onlyEm && onlyEm.textContent.trim() === desc.textContent.trim()) {
      desc.classList.add('job__descriptor');
    }
  }
}

function chipifyStack(body) {
  const ps = [...body.querySelectorAll('p')];
  const stackP = ps.find((p) => {
    const s = p.querySelector('strong');
    return s && s.textContent.trim().toLowerCase().startsWith('stack');
  });
  if (!stackP) return;

  const fullText = stackP.textContent;
  const colonIdx = fullText.indexOf(':');
  const techText = colonIdx >= 0 ? fullText.slice(colonIdx + 1).trim() : '';

  const wrap = document.createElement('div');
  wrap.className = 'job__stack';

  const label = document.createElement('span');
  label.className = 'job__stack-label';
  label.textContent = 'Stack';
  wrap.appendChild(label);

  const list = document.createElement('ul');
  list.className = 'chips chips--stack';
  list.setAttribute('aria-label', 'Tech stack');

  techText.split('·').forEach((t) => {
    const tech = t.trim();
    if (!tech) return;
    const li = document.createElement('li');
    li.className = 'chip';
    li.dataset.skill = slug(tech);
    li.textContent = tech;
    list.appendChild(li);
  });

  wrap.appendChild(list);
  stackP.replaceWith(wrap);
}

function enrichSkills(section) {
  const table = section.querySelector('table');
  if (!table) return;

  const rows = [...table.querySelectorAll('tbody tr')];
  const groups = [];

  rows.forEach((row) => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;
    const catName = cells[0].textContent.trim();
    const catSlug = slug(catName);
    const skills = cells[1].textContent.split('·').map((s) => s.trim()).filter(Boolean);
    groups.push({ name: catName, slug: catSlug, skills });
  });

  if (!groups.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'skills';

  const catList = document.createElement('div');
  catList.className = 'skills__categories';
  catList.setAttribute('role', 'group');
  catList.setAttribute('aria-label', 'Filter skills by category');

  groups.forEach((g) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip';
    btn.dataset.category = g.slug;
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = g.name;
    catList.appendChild(btn);
  });
  wrap.appendChild(catList);

  const groupsWrap = document.createElement('div');
  groupsWrap.className = 'skills__groups';

  groups.forEach((g) => {
    const grp = document.createElement('div');
    grp.className = 'skill-group';
    grp.dataset.category = g.slug;

    const heading = document.createElement('h3');
    heading.className = 'skill-group__name';
    heading.textContent = g.name;
    grp.appendChild(heading);

    const ul = document.createElement('ul');
    ul.className = 'chips chips--skills';
    g.skills.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.dataset.skill = slug(s);
      li.dataset.category = g.slug;
      li.textContent = s;
      ul.appendChild(li);
    });
    grp.appendChild(ul);
    groupsWrap.appendChild(grp);
  });
  wrap.appendChild(groupsWrap);

  table.replaceWith(wrap);
}

function enrichProjects(section) {
  const ul = section.querySelector('ul');
  if (!ul) return;

  const cards = document.createElement('div');
  cards.className = 'projects';

  [...ul.children].forEach((li) => {
    if (li.tagName !== 'LI') return;

    const link = li.querySelector('strong a, a');
    const em = li.querySelector('em');
    const name = link
      ? link.textContent.trim()
      : li.querySelector('strong')?.textContent.trim() || 'Project';
    const href = link?.getAttribute('href') || '';
    const techText = em ? em.textContent.trim() : '';

    const liClone = li.cloneNode(true);
    liClone.querySelector('strong')?.remove();
    liClone.querySelector('em')?.remove();
    const descHtml = liClone.innerHTML.replace(/^[\s—\-–—]+/, '').trim();

    const card = document.createElement('article');
    card.className = 'project';

    const heading = document.createElement('h3');
    heading.className = 'project__name';
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = name;
      heading.appendChild(a);
    } else {
      heading.textContent = name;
    }
    card.appendChild(heading);

    if (techText) {
      const chips = document.createElement('ul');
      chips.className = 'chips chips--project';
      chips.setAttribute('aria-label', 'Project tech');
      techText.split('·').forEach((t) => {
        const tech = t.trim();
        if (!tech) return;
        const c = document.createElement('li');
        c.className = 'chip';
        c.dataset.skill = slug(tech);
        c.textContent = tech;
        chips.appendChild(c);
      });
      card.appendChild(chips);
    }

    if (descHtml) {
      const p = document.createElement('p');
      p.className = 'project__desc';
      p.innerHTML = descHtml;
      card.appendChild(p);
    }

    cards.appendChild(card);
  });

  ul.replaceWith(cards);

  const trailingP = section.querySelector('p > em');
  if (trailingP) trailingP.parentElement.classList.add('projects__footnote');
}

function enrichEducation(section) {
  const ul = section.querySelector('ul');
  if (!ul) return;

  const list = document.createElement('div');
  list.className = 'edu-list';

  [...ul.children].forEach((li) => {
    if (li.tagName !== 'LI') return;
    const entry = document.createElement('div');
    entry.className = 'edu-entry';
    entry.innerHTML = li.innerHTML;
    list.appendChild(entry);
  });

  ul.replaceWith(list);
}

// =====================================================================
// Reveal preparation (pre-mount, avoids FOUC)
// =====================================================================

function prepareReveal(sections) {
  const targets = new Set();
  sections.forEach((s) => {
    targets.add(s);
    s.querySelectorAll('.job, .project, .edu-entry, .chip').forEach((el) =>
      targets.add(el),
    );
  });
  targets.forEach((el) => el.classList.add('is-offscreen'));
}

// =====================================================================
// Wiring
// =====================================================================

function buildNav(sections) {
  const navUl = document.getElementById('navLinks');
  if (!navUl) return;
  navUl.innerHTML = '';

  sections.forEach((section) => {
    const label = NAV_LABELS[section.id] || section.querySelector('h2')?.textContent || section.id;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${section.id}`;
    a.textContent = label;
    a.dataset.section = section.id;
    li.appendChild(a);
    navUl.appendChild(li);
  });
}

// Priority+ nav: measures the link row and moves trailing links into a
// "More ▾" dropdown until the row fits, re-running on resize (and once the
// webfonts land, since they change link widths).
function initNavPriority() {
  const row = document.getElementById('navLinks');
  if (!row) return;

  const moreLi = document.createElement('li');
  moreLi.className = 'topnav__more';
  moreLi.hidden = true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topnav__more-btn';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'navMoreMenu');
  btn.innerHTML = 'More <span class="topnav__more-caret" aria-hidden="true">▾</span>';

  const menu = document.createElement('ul');
  menu.className = 'topnav__more-menu';
  menu.id = 'navMoreMenu';
  menu.setAttribute('role', 'list');

  moreLi.append(btn, menu);
  row.appendChild(moreLi);

  function setOpen(open) {
    moreLi.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  btn.addEventListener('click', () => {
    setOpen(!moreLi.classList.contains('is-open'));
  });

  // Close after picking a section, on outside click, and on Escape.
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!moreLi.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreLi.classList.contains('is-open')) {
      setOpen(false);
      btn.focus();
    }
  });

  function layout() {
    // Restore every link to the row, then demote trailing ones until it fits.
    while (menu.firstChild) row.insertBefore(menu.firstChild, moreLi);
    moreLi.hidden = true;
    setOpen(false);
    if (row.scrollWidth <= row.clientWidth + 1) return;

    moreLi.hidden = false;
    const items = [...row.children].filter((li) => li !== moreLi);
    for (let i = items.length - 1; i >= 0 && row.scrollWidth > row.clientWidth + 1; i--) {
      menu.insertBefore(items[i], menu.firstChild);
    }
  }

  window.addEventListener('resize', layout);
  document.fonts?.ready?.then(layout);
  layout();
}

function wireCollapse(mount) {
  mount.addEventListener('click', (e) => {
    const header = e.target.closest('.job__header');
    if (!header) return;
    const article = header.closest('.job');
    if (!article) return;
    const expanded = article.getAttribute('aria-expanded') === 'true';
    article.setAttribute('aria-expanded', String(!expanded));
    header.setAttribute('aria-expanded', String(!expanded));
  });
}

function wireSkillsFilter(mount) {
  const catChips = [...mount.querySelectorAll('.cat-chip')];
  const skillGroups = [...mount.querySelectorAll('.skill-group')];
  const skillsWrap = mount.querySelector('.skills');
  if (!catChips.length || !skillGroups.length) return;

  const categoryTokens = new Map();
  skillGroups.forEach((g) => {
    const tokens = new Set();
    g.querySelectorAll('.chip').forEach((chip) => {
      tokenizeSkill(chip.textContent.trim()).forEach((t) => tokens.add(t.toLowerCase()));
    });
    categoryTokens.set(g.dataset.category, tokens);
  });

  function clearFilter() {
    catChips.forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-pressed', 'false');
    });
    mount.querySelectorAll('[data-skill]').forEach((c) => {
      c.classList.remove('is-highlighted', 'is-dimmed');
    });
    skillGroups.forEach((g) => g.classList.remove('is-shown'));
    skillsWrap?.classList.remove('has-active-group');
  }

  catChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Toggle this category on/off
      const isNowActive = !btn.classList.contains('is-active');
      btn.classList.toggle('is-active', isNowActive);
      btn.setAttribute('aria-pressed', String(isNowActive));

      // Gather all currently active categories
      const activeCats = catChips
        .filter((b) => b.classList.contains('is-active'))
        .map((b) => b.dataset.category);

      if (!activeCats.length) {
        clearFilter();
        return;
      }

      // Union of tokens across all active categories
      const allTokens = new Set();
      activeCats.forEach((cat) => {
        (categoryTokens.get(cat) || new Set()).forEach((t) => allTokens.add(t));
      });

      // Highlight chips matching any active category
      mount.querySelectorAll('[data-skill]').forEach((chip) => {
        const inActiveCategory = activeCats.includes(chip.dataset.category);
        const matches = inActiveCategory || chipMatchesTokens(chip.textContent.trim(), allTokens);
        chip.classList.toggle('is-highlighted', matches);
        chip.classList.toggle('is-dimmed', !matches);
      });

      // Show skill groups for all active categories
      skillGroups.forEach((g) => g.classList.toggle('is-shown', activeCats.includes(g.dataset.category)));
      skillsWrap?.classList.add('has-active-group');

      // Auto-expand jobs that have at least one highlighted stack chip
      mount.querySelectorAll('.job').forEach((job) => {
        if (job.querySelector('.chip.is-highlighted')) {
          job.setAttribute('aria-expanded', 'true');
          job.querySelector('.job__header')?.setAttribute('aria-expanded', 'true');
        }
      });
    });
  });
}

function tokenizeSkill(text) {
  const out = [text];
  const m = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const base = m[1].trim();
    out.push(base);
    m[2].split(',').forEach((item) => {
      const itm = item.trim();
      if (itm) {
        out.push(`${base} ${itm}`);
        out.push(itm);
      }
    });
  }
  return out;
}

function chipMatchesTokens(chipText, tokens) {
  const c = chipText.toLowerCase().trim();
  if (tokens.has(c)) return true;
  for (const tok of tokens) {
    if (tok === c) return true;
    if (tok.length > c.length && tok.startsWith(c) && /[\s/(\-]/.test(tok[c.length])) return true;
    if (c.length > tok.length && c.startsWith(tok) && /[\s/(\-]/.test(c[tok.length])) return true;
  }
  return false;
}

function initActiveSectionTracker() {
  const sections = [...document.querySelectorAll('main#cv > section')];
  const links = [...document.querySelectorAll('#navLinks a')];
  if (!sections.length || !links.length) return;

  const navHeight =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10) || 56;

  function update() {
    const threshold = navHeight + 24;
    let activeId = sections[0].id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top - threshold <= 0) activeId = s.id;
      else break;
    }
    links.forEach((a) => a.classList.toggle('is-active', a.dataset.section === activeId));
  }

  let raf = null;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      update();
      raf = null;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  const saved = localStorage.getItem('cvTheme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));

  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('cvTheme', next);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

function initRevealObserver(mount) {
  const targets = mount.querySelectorAll('.is-offscreen');
  if (!targets.length || !('IntersectionObserver' in window)) {
    mount.querySelectorAll('.is-offscreen').forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
  );

  targets.forEach((el) => observer.observe(el));
}
