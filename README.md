# typbase

Local-first knowledge base where Typst is the app's data language and atproto Spaces is the sync and sharing layer. See `/home/lemuel/.opencode/plan/typbase-plan.md` for the full plan.

## Repo layout

- `app/` — Nuxt app (web PWA, later Tauri shell)
- `platform/wasm/` — Rust crate `@typbase/wasm`: Typst compiler + IDE engine in WASM
- `platform/wasm/pkg/` — the published npm package (wasm-pack output, pnpm workspace member)
- `packages/codemirror/` — CodeMirror 6 Typst editing: WYSIWYG inline preview, highlight, hover, autocomplete
- `packages/typing/` — `@typbase/typing`: workspace/page types shared app <-> storage <-> (later) server
- `packages/storage/` — `@typbase/storage`: OPFS/Memory backends and the Loro doc registry
- `packages/spaces/` — `@typbase/spaces`: the only module that touches `@atproto/*`
- `platform/` — cargo workspace root (Tauri joins later)

## Status

`/` is the local guest workspace: a sidebar (pages by category, daily notes, categories editor,
settings popover), and a four-mode page view (Write, Split, Source, Read) over
CodeMirror + `@typbase/wasm`. Pages and categories live in Loro docs snapshotted to OPFS
(`workspaces/local/...`). The app stdlib is real: pages can run

```typst
#let pages = typbase.query("pages")   // JSON from the workspace
#typbase.embed("<page-id>")           // includes another page's source
```

The engine asks for data through the existing TypstRequest channel; the app answers with
synthesized JSON at `typbase-query/<kind>.json` and page sources at `typbase-src/<id>.typ`.
Workspace settings pick text/math/code fonts, and the settings popover can install every
system font into the engine (Local Font Access API, Chromium).

`/debug` (linked from the sidebar footer) is a lab for the pipeline: compile arbitrary Typst
against the workspace, check the raw/synth index mapper invariants, run a recovery battery
(broken math, unknown vars, unclosed brackets, self-embeds, 300-paragraph docs), simulate
typing while watching the wasm heap, and reset/wipe the local workspace.

Rendering geometry: panes are measured in CSS pixels and converted to points inside
`TypstState::resize`; the SVG frames each pane renders are sized to it, so inline widgets,
split, and read views all lay out at the width the user sees.

## Development

Prerequisites: Node 26+, pnpm 12+, Rust with `wasm32-unknown-unknown` target, wasm-pack.

```sh
pnpm install
pnpm dev   # moon run web:dev: builds @typbase/wasm + @typbase/codemirror, then starts the Nuxt app
```

Builds run through moon (`build`, `dev`, `generate`, `preview`, `wasm:build`, `packages:build`); the npm scripts delegate to it. Check the tasks in `moon.yml`, `platform/wasm/moon.yml`, and `packages/codemirror/moon.yml`.

## Shared packages

`@typbase/wasm` and `@typbase/codemirror` are the extracted mnemo editor stack, canonical here and published from CI on release. Mnemo migrates to the published packages after the first release.

`@typbase/storage`, `@typbase/typing`, and `@typbase/spaces` are new code. All three build
with tsdown to `dist/` and publish from CI on release.
