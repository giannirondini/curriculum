# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A static site that renders `cv.md` as a polished, interactive CV — in two front-ends that share the same markdown:

- **Classic** (`/`, `index.html` + `main.js` + `style.css`): the designed single-page CV.
- **CLI** (`/cli/`, `cli/`): the same CV as an AI-assistant-style terminal — slash commands plus plain-English questions answered **offline** (intent rules + BM25 retrieval, no LLM).

Vanilla HTML/CSS/JS only — no framework, no Node, no build pipeline. Deployed to GitHub Pages; `cli/` is published automatically at `/cli/` by the same workflow.

## Commands

There is no build, lint, or test setup. The site runs directly from source.

```bash
# Local dev: serve from repo root, then open http://localhost:8000/ (classic)
# and http://localhost:8000/cli/ (terminal)
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

- Each skill in a category is tokenized via `tokenizeSkill()` — for `"Azure (Databricks, Functions, CDN, APIM)"` this yields `["Azure (Databricks, ...)", "Azure", "Azure Databricks", "Databricks", "Azure Functions", ...]`. The parenthesis may also sit mid-name: `"MCP (Model Context Protocol) server development"` also yields `"MCP server development"`, `"MCP"` and `"Model Context Protocol"`.
- `chipMatchesTokens()` uses word-boundary `startsWith` matching so `"Java"` doesn't false-positive on `"JavaScript"`, but `"Azure Databricks"` correctly matches the parenthesized form.

If a stack/project chip refuses to highlight under the right category, the fix is usually to adjust how the skill is written in the Core Competencies table, not to add special cases in `main.js`.

`tokenizeSkill()` and `chipMatchesTokens()` live in `shared/skill-match.js` and are imported by **both** front-ends, so the classic category filter and the CLI's `/skills <category>` "where used" view always agree.

## CLI version (`cli/`)

Native ES modules, no bundler. Reads `../cv.md`, `../vendor/marked.min.js`, `../assets/me.jpg`, `../pdf/…` — nothing is duplicated. Pipeline (`cli/js/`):

| Module | Role |
|---|---|
| `model.js` | `cv.md` → structured model (header, summary, skills, jobs, projects, lists, tables). Same conventions as the classic enrichment passes; a section that breaks them is downgraded to `kind: 'generic'` and rendered as plain markdown (`/doctor` lists the fallbacks). |
| `facts.js` | Queries over the model: skill usage ("where was X used"), entity vocabulary for free text, related-tech hints for things **not** in the CV (`RELATED` map), typo suggestions. |
| `views.js` | All renderers. Every view returns `{ html, suggest }`; `suggest` feeds the suggestion bar. |
| `commands.js` | Slash-command registry. Section commands are generated from `## Headings`, so a new section in `cv.md` gets a `/command` automatically. Easter eggs are `hidden: true`. |
| `answer.js` | Free-text router: small talk → intent regexes → entity lookup → BM25 retrieval → honest "not in the CV". Every answer is rendered from the model; it must never state anything that isn't in `cv.md`. |
| `search.js` | Tokenizer, light stemmer, query-side synonyms, BM25 over per-bullet chunks, snippet highlighting. |
| `ascii.js` | Photo → ASCII portrait for the neofetch banner (canvas, background removal, theme-aware density). |
| `ui.js` | Transcript, spinner, token-style streaming, slash palette (ARIA combobox), history, suggestions, live-region announcements. |
| `app.js` | Bootstrap, boot log, banner, input routing (commands / shell-isms / questions), URL-hash deep links, theme. |

Conventions:

- **Escaping:** use the `html` tagged template from `util.js` — interpolations are escaped; only cv.md-derived markup goes through `raw()`. Visitor input is never parsed as HTML (it is echoed via `textContent`).
- **Deep links:** the URL hash is the last command/question (`cli/#/skills+ai`, `cli/#what+is+mcp`), kept current with `history.replaceState`. Commands with side effects (`/pdf`, `/theme`, `/share`, `/clear`, `/classic`) set `deeplink: false`.
- **Motion:** boot log (once per tab session), thinking spinner and streaming all respect `prefers-reduced-motion`, and any key / Esc / click skips them.
- **Theme:** shared with the classic site via `localStorage.cvTheme`; an inline `<head>` script applies it before first paint.
- **Pronouns:** answers refer to the CV owner by name, never by pronoun.
- When a question routes badly, prefer fixing the intent regex / synonym map in `answer.js` / `search.js` over special-casing content.

## Animations

Two distinct mechanisms — both wrapped in `@media (prefers-reduced-motion: no-preference)`:

- **Hero stagger** (4 elements fading in on first paint): pure CSS `@keyframes heroFadeIn` with per-child `animation-delay` on `.hero__photo` and `.hero__text > *:nth-child(N)`. `animation-fill-mode: backwards` keeps the from-state applied during the delay → no FOUC.
- **Scroll-triggered reveals** (sections, jobs, projects, chips): JS-driven via single `IntersectionObserver`. `prepareReveal()` adds `.is-offscreen` to all targets **before** mounting the fragment into `#cv` — applying it after mount would flash the final state for one frame.

## Theme

`initThemeToggle()` runs **before** the markdown fetch so the page never paints in the wrong theme on reload. Stored in `localStorage.cvTheme`; first visit honors `prefers-color-scheme`. Toggle button updates `aria-pressed` + `aria-label` so screen readers announce the action.

## Print

`@media print` overrides design tokens (forces light theme), hides nav/buttons/category chips, force-expands every `.job__body` regardless of `aria-expanded`, kills timeline rails and reveal-animation classes, and reflows projects to a 2-col grid. Cmd-P should produce a clean single-column document.

## Files that matter

- `cv.md` — content, single source of truth (for both front-ends)
- `main.js` — enrichment pipeline + interactions (the architectural core of the classic site)
- `shared/skill-match.js` — skill tokenizing/matching shared by both front-ends
- `cli/` — terminal front-end (`index.html`, `cli.css`, `js/*` — see "CLI version" above)
- `style.css` — tokens + layout + dark theme + print
- `vendor/marked.min.js` — vendored, do not modify
- `.github/workflows/deploy.yml` — Pages deploy, no build step
- `index.html` — semantic shell only, no CV content
