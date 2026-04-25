# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-page static site that renders `cv.md` as a polished, interactive CV. Vanilla HTML/CSS/JS only — no framework, no Node, no build pipeline. Deployed to GitHub Pages.

## Commands

There is no build, lint, or test setup. The site runs directly from source.

```bash
# Local dev: serve from repo root, then open http://localhost:8000/
python3 -m http.server 8000

# Deploy: push to main. .github/workflows/deploy.yml stages all files
# (excluding prompt.md, README.md, .git, .github, .DS_Store) and publishes
# via actions/deploy-pages. Repo Settings → Pages must use "Source: GitHub Actions".
```

When iterating on layout, hard-reload (Cmd-Shift-R) — `cv.md` is fetched with `cache: 'no-cache'`, but `style.css` and `main.js` are not.

## Architecture: the three-layer rendering pipeline

`cv.md` is the **single source of truth**. Do not hardcode CV content into `index.html`. The page is assembled at runtime in three stages, all in `main.js`:

1. **Parse**: `marked.parse(md)` (vendored at `vendor/marked.min.js`) produces raw HTML inside a detached `<div>`.
2. **Enrichment passes**: `main.js` walks the detached fragment and *transforms* it before mount. This is what turns flat markdown output into the styled CV — wrapping H2-blocks into `<section>`s, converting each Experience H3 + siblings into `<article class="job">` with collapsible body, splitting meta lines into `.job-company`/`.job-team`/`.job-dates` spans, turning Stack paragraphs into `<ul class="chips">` with `data-skill` attributes, converting the Core Competencies table into a category-filter UI, etc.
3. **Mount + wire**: the enriched fragment is appended to `<main id="cv">`, then nav, collapse handlers, skills filter, theme toggle, scroll observers are wired.

CSS in `style.css` only targets the **enriched** structure (`.job`, `.chip`, `.skill-group`, `.edu-entry`) — never the raw `<h3>`/`<ul>` output of marked.

### Editing `cv.md`

Enrichment depends on the CV following specific conventions. **If a section breaks the convention, that section's enrichment throws and `bootstrap()` logs a warning then falls back to plain marked output for that section** — the rest of the page still renders. Conventions in use:

- **Header** (top of file): H1 name → `**bold subtitle**` paragraph → contacts paragraph → `---`. Goes into `.hero`.
- **Sections**: each `## Heading` becomes `<section id="{slug}">`. Slug is derived from heading text. To add the new section to the sticky nav, also add a `NAV_LABELS` entry in `main.js` (otherwise the raw heading text is used).
- **Experience jobs**: `### Title` → `**Company** · Team · *Dates*` paragraph → optional `*descriptor*` paragraph → bullet list → `**Stack:** A · B · C` paragraph. The Stack paragraph is split on `·` to produce chips.
- **Projects**: each `<li>` should be `**[Name](url)** — *Tech · A · B* \n description text`.
- **Skills table**: 2-column markdown table in `## Core Competencies`. Column 1 = category name (becomes a clickable filter chip), column 2 = `Skill A · Skill B · Skill (X, Y, Z)`. Parenthesized lists get auto-expanded into individual tokens for filter matching.

### Skills filter matching

Clicking a category chip highlights matching `[data-skill]` elements **across the page** — Core Competencies, job Stack chips, project tech chips. Matching is **token-based and fuzzy**, not exact-slug equality:

- Each skill in a category is tokenized via `tokenizeSkill()` — for `"Azure (Databricks, Functions, CDN, APIM)"` this yields `["Azure (Databricks, ...)", "Azure", "Azure Databricks", "Databricks", "Azure Functions", ...]`.
- `chipMatchesTokens()` uses word-boundary `startsWith` matching so `"Java"` doesn't false-positive on `"JavaScript"`, but `"Azure Databricks"` correctly matches the parenthesized form.

If a stack/project chip refuses to highlight under the right category, the fix is usually to adjust how the skill is written in the Core Competencies table, not to add special cases in `main.js`.

## Animations

Two distinct mechanisms — both wrapped in `@media (prefers-reduced-motion: no-preference)`:

- **Hero stagger** (4 elements fading in on first paint): pure CSS `@keyframes heroFadeIn` with per-child `animation-delay` on `.hero__photo` and `.hero__text > *:nth-child(N)`. `animation-fill-mode: backwards` keeps the from-state applied during the delay → no FOUC.
- **Scroll-triggered reveals** (sections, jobs, projects, chips): JS-driven via single `IntersectionObserver`. `prepareReveal()` adds `.is-offscreen` to all targets **before** mounting the fragment into `#cv` — applying it after mount would flash the final state for one frame.

## Theme

`initThemeToggle()` runs **before** the markdown fetch so the page never paints in the wrong theme on reload. Stored in `localStorage.cvTheme`; first visit honors `prefers-color-scheme`. Toggle button updates `aria-pressed` + `aria-label` so screen readers announce the action.

## Print

`@media print` overrides design tokens (forces light theme), hides nav/buttons/category chips, force-expands every `.job__body` regardless of `aria-expanded`, kills timeline rails and reveal-animation classes, and reflows projects to a 2-col grid. Cmd-P should produce a clean single-column document.

## Files that matter

- `cv.md` — content, single source of truth
- `main.js` — enrichment pipeline + interactions (the architectural core)
- `style.css` — tokens + layout + dark theme + print
- `vendor/marked.min.js` — vendored, do not modify
- `.github/workflows/deploy.yml` — Pages deploy, no build step
- `index.html` — semantic shell only, no CV content
