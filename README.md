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
bun run dev        # http://localhost:3517 (vite, web)
bun run check      # format:check + lint + lint:md
bun run test
bun run build      # tsc && vite build → dist/
```

Append `?debug` to attach `@vectojs/devtools` and expose `window.__app = { scene, model, markdown }`.

### Desktop (Tauri v2)

Prerequisites — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```bash
# CachyOS / Arch
sudo pacman -S webkit2gtk-4.1 gtk3 base-devel openssl appmenu-gtk-module libappindicator-gtk3 librsvg

# rustup + cargo already via rustup stable (1.77.2+); verify:
cargo --version && rustc --version
```

Icons are generated from `public/pwa-*.png` into `src-tauri/icons/` (32x32, 128x128, 256, 512 + ico/icns) via `magick` or the `tauri icon` helper — do not hand-edit `src-tauri/icons/` without regenerating.

```bash
bun install                          # installs @tauri-apps/cli + @tauri-apps/api
bun run tauri:dev                    # vite dev at http://localhost:3517 + Tauri window
bun run tauri:build                  # vite build + cargo tauri build → src-tauri/target/release/bundle/
cargo check --manifest-path src-tauri/Cargo.toml   # fast Rust check without bundling
cargo test --manifest-path src-tauri/Cargo.toml    # Rust unit tests (greet, fs roundtrip)
```

`src-tauri/tauri.conf.json`:

- `identifier: com.vectojs.scribe`
- `build.frontendDist: ../dist`
- `build.devUrl: http://localhost:3517`
- `bundle.icon`: `icons/32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png/.icns/.ico` (from `public/pwa-*.png`)

Filesystem access uses `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-dialog` (permissions in `src-tauri/capabilities/default.json` — `fs:allow-read-text-file`, `write-text-file`, `read-dir`, `dialog:allow-open/save`, `fs:scope **`). JS helpers in `src/utils/tauri.ts` (`openMarkdownFile`, `saveMarkdownFile`) fall back to Rust commands `read_markdown_file` / `write_markdown_file` via `invoke` when needed.

## Layout

- Outer chrome is plain HTML/CSS flex (`#scribe-header`, `#scribe-explorer`, `#scribe-settings`).
- Center `#scribe-stage` hosts `<canvas id="scribe-canvas">` + `<div id="scribe-a11y-root">` for the VectoJS `Scene`.
- `Scene` uses `disableWindowResize:true` + `ResizeObserver` on `#scribe-stage`.

## R2 Assets

Public assets live in `cdn-vectojs` bucket namespace `scribe/*` (e.g. `scribe/logo.svg`). Upload with `wrangler r2 object put scribe/logo.svg --file=... --remote` and verify `200` + `content-type`; link `https://cdn.vectojs.org/scribe/...`.

## Roadmap

- CTX-0532 scaffold (this) → CTX-0533 hybrid core editor (TextArea source + Markdown preview, scroll sync) → CTX-0534 file explorer/TOC/sync/export → CTX-0535 a11y/virt polish + e2e + R2 + deploy.
