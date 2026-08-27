# Scribe — VectoJS Markdown Editor

StackEdit-inspired markdown editor built as a VectoJS forge. Hybrid shell: traditional HTML chrome (header toolbar, file explorer `<nav>`, settings panel) wrapping a VectoJS canvas core (`#scribe-canvas` + `#scribe-a11y-root`).

- **Family**: `vectojs-native/scribe/` (container; each child is its own git repo).
- **Deployed**: <https://scribe.vectojs.org> (Cloudflare Pages, `scribe` project).
- **StackEdit reference**: <https://stackedit.io>

## Tech Stack

- `bun` + `vite` + `typescript` (strict)
- `@vectojs/core`, `@vectojs/ui`, `@vectojs/markdown`, `@vectojs/styles` (exact-pinned, never `workspace:*`)
- `oxfmt` / `oxlint` / `biome` / `markdownlint-cli2` / `lefthook`

## Development

```bash
bun install
bun run dev        # http://localhost:3517
bun run check      # format:check + lint + lint:md
bun run test
bun run build
```

Append `?debug` to attach `@vectojs/devtools` and expose `window.__app = { scene, model, markdown }`.

## Layout

- Outer chrome is plain HTML/CSS flex (`#scribe-header`, `#scribe-explorer`, `#scribe-settings`).
- Center `#scribe-stage` hosts `<canvas id="scribe-canvas">` + `<div id="scribe-a11y-root">` for the VectoJS `Scene`.
- `Scene` uses `disableWindowResize:true` + `ResizeObserver` on `#scribe-stage`.

## R2 Assets

Public assets live in `cdn-vectojs` bucket namespace `scribe/*` (e.g. `scribe/logo.svg`). Upload with `wrangler r2 object put scribe/logo.svg --file=... --remote` and verify `200` + `content-type`; link `https://cdn.vectojs.org/scribe/...`.

## Roadmap

- CTX-0532 scaffold (this) → CTX-0533 hybrid core editor (TextArea source + Markdown preview, scroll sync) → CTX-0534 file explorer/TOC/sync/export → CTX-0535 a11y/virt polish + e2e + R2 + deploy.
