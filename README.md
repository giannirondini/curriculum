# Curriculum Vitae

Personal CV site for [Gianni Rondini](https://github.com/giannirondini) — built as a static single-page app and deployed to GitHub Pages.

**Live:**

- Classic: https://giannirondini.github.io/curriculum/
- Terminal: https://giannirondini.github.io/curriculum/cli/ — the same CV as an AI-assistant-style CLI. Try `/help`, `/experience`, `/skills ai`, `/mcp`, or just ask *"What is Gianni working on now?"*. Answers are computed offline from `cv.md` (intent rules + BM25 retrieval, no LLM). Deep links work: `cli/#/projects+anchor`.

## How it works

`cv.md` is the single source of truth for all content. At runtime, `main.js` fetches and renders it through a three-stage pipeline:

1. **Parse** — [marked](https://marked.js.org/) converts Markdown to HTML
2. **Enrich** — enrichment passes transform the raw HTML into semantic, interactive components (collapsible job cards, skill filter, project cards, etc.)
3. **Mount** — the enriched fragment is injected into the page and interactions are wired up

No framework, no build step, no Node.

The terminal version (`cli/`) reads the same `cv.md`, parses it into a structured model, and answers slash commands and free-text questions from it in the browser. Add a `## Section` to the markdown and both versions pick it up (the CLI also gets a matching `/command`).

## Local dev

```bash
python3 -m http.server 8000
# open http://localhost:8000/      (classic)
# open http://localhost:8000/cli/  (terminal)
```

`cv.md` is fetched with `cache: 'no-cache'` on every load. For `style.css` / `main.js` changes, hard-reload with **Cmd-Shift-R**.

## Files

| File | Role |
|---|---|
| `cv.md` | CV content — edit this |
| `main.js` | Rendering pipeline + all interactions |
| `style.css` | Design tokens, layout, dark mode, print |
| `index.html` | Semantic shell only |
| `shared/skill-match.js` | Skill matching shared by both versions |
| `cli/` | Terminal version (`index.html`, `cli.css`, `js/` modules) |
| `vendor/marked.min.js` | Vendored Markdown parser |

## Deploy

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) builds and publishes via `actions/deploy-pages`. Both versions ship in the same artifact; no workflow changes are needed for `/cli/`.

Repo **Settings → Pages** must be set to **Source: GitHub Actions**.
