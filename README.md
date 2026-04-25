# Curriculum Vitae

Personal CV site for [Gianni Rondini](https://github.com/giannirondini) — built as a static single-page app and deployed to GitHub Pages.

**Live:** https://giannirondini.github.io/curriculum

## How it works

`cv.md` is the single source of truth for all content. At runtime, `main.js` fetches and renders it through a three-stage pipeline:

1. **Parse** — [marked](https://marked.js.org/) converts Markdown to HTML
2. **Enrich** — enrichment passes transform the raw HTML into semantic, interactive components (collapsible job cards, skill filter, project cards, etc.)
3. **Mount** — the enriched fragment is injected into the page and interactions are wired up

No framework, no build step, no Node.

## Local dev

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

`cv.md` is fetched with `cache: 'no-cache'` on every load. For `style.css` / `main.js` changes, hard-reload with **Cmd-Shift-R**.

## Files

| File | Role |
|---|---|
| `cv.md` | CV content — edit this |
| `main.js` | Rendering pipeline + all interactions |
| `style.css` | Design tokens, layout, dark mode, print |
| `index.html` | Semantic shell only |
| `vendor/marked.min.js` | Vendored Markdown parser |

## Deploy

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) builds and publishes via `actions/deploy-pages`.

Repo **Settings → Pages** must be set to **Source: GitHub Actions**.
