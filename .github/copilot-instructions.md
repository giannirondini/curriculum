# Copilot Instructions

## Project

Single-page static CV site. Vanilla HTML/CSS/JS only — no framework, no Node, no build pipeline. Deployed to GitHub Pages via `.github/workflows/deploy.yml`.

**Do not introduce npm, bundlers, frameworks, or server-side code.**

## Local Dev

```bash
python3 -m http.server 8000   # serve from repo root → http://localhost:8000/
```

After editing `style.css` or `main.js`, hard-reload (Cmd-Shift-R) in the browser — only `cv.md` is fetched with `cache: 'no-cache'`.

## Architecture: Three-Layer Rendering Pipeline

`cv.md` is the **single source of truth** for all CV content. Never hardcode CV data into `index.html`.

At runtime, `main.js` assembles the page in three stages:

1. **Parse** — `marked.parse(md)` (vendored at `vendor/marked.min.js`) produces raw HTML in a detached `<div>`.
2. **Enrichment passes** — `main.js` walks the detached fragment and transforms it:
   - `splitHeader()` → builds `.hero` from H1 + subtitle + contacts
   - `groupSections()` → wraps each `## Heading` block into `<section id="{slug}">`
   - `enrichExperience()` → converts H3 + siblings into `<article class="job">` with collapsible body, `.job-company`/`.job-team`/`.job-dates` spans, and `<ul class="chips">` for Stack entries
   - `enrichSkills()` → converts the Core Competencies table into a category-filter UI
   - `enrichProjects()` → turns project list items into card-like entries with tech chips
   - `enrichEducation()` → wraps education entries in `.edu-entry`
3. **Mount + wire** — enriched fragment appended to `<main id="cv">`, then nav, collapse handlers, skills filter, theme toggle, and scroll observers are wired.

`style.css` targets only the **enriched** structure (`.job`, `.chip`, `.skill-group`, `.edu-entry`). Do not add CSS for raw marked output like bare `<h3>` or `<ul>`.

## Key Files

| File | Role |
|------|------|
| `cv.md` | Content — single source of truth |
| `main.js` | Enrichment pipeline + all interactions |
| `style.css` | Design tokens, layout, dark theme, print |
| `index.html` | Semantic shell only — no CV content |
| `vendor/marked.min.js` | Vendored parser — **do not modify** |

## `cv.md` Conventions

Enrichment passes depend on strict formatting. Deviating silently falls back to plain HTML for that section.

- **Header**: `# Name` → `**Bold subtitle**` paragraph → contacts paragraph → `---`
- **Sections**: `## Heading` → becomes `<section id="{slug}>`. Add a `NAV_LABELS` entry in `main.js` for custom nav label.
- **Experience jobs**: `### Title` → `**Company** · Team · *Dates*` paragraph → optional `*descriptor*` → bullet list → `**Stack:** A · B · C` paragraph (split on `·` for chips)
- **Projects**: `**[Name](url)** — *Tech · A · B*` followed by description text
- **Skills table**: 2-column table in `## Core Competencies`. Col 1 = category name, Col 2 = `Skill A · Skill B · Skill (X, Y, Z)`. Parenthesized items are auto-expanded for filter matching.

## Skills Filter

`tokenizeSkill()` + `chipMatchesTokens()` handle fuzzy, word-boundary token matching across Core Competencies chips, job Stack chips, and project tech chips. If a chip won't highlight under the right category, fix the skill wording in the table — don't add special cases in `main.js`.

## Animations

- **Hero stagger**: pure CSS `@keyframes heroFadeIn` with `animation-delay` per child; `animation-fill-mode: backwards` prevents FOUC during delay.
- **Scroll reveals**: single `IntersectionObserver`. `prepareReveal()` adds `.is-offscreen` **before** mounting the fragment — never after.
- Both wrapped in `@media (prefers-reduced-motion: no-preference)`.

## Theme

`initThemeToggle()` runs **before** the `cv.md` fetch so the page never flashes on reload. Stored in `localStorage.cvTheme`; defaults to `prefers-color-scheme`.

## Print

`@media print` forces light theme, hides nav/buttons/chips, force-expands all `.job__body` elements, removes timeline rails and reveal classes, and reflows projects to 2-col grid.

## Deploy

Push to `main` triggers `.github/workflows/deploy.yml`, which stages all files (excluding `prompt.md`, `README.md`, `.git`, `.github`, `.DS_Store`) and publishes via `actions/deploy-pages`. Repo Settings → Pages must use **Source: GitHub Actions**.
