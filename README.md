# typbase

Local-first knowledge base where Typst is the app's data language and atproto Spaces is the sync and sharing layer. See `/home/lemuel/.opencode/plan/typbase-plan.md` for the full plan.

## Repo layout

- `app/` — Nuxt app (web PWA, later Tauri shell)
- `platform/wasm/` — Rust crate `@typbase/wasm`: Typst compiler + IDE engine in WASM
- `platform/wasm/pkg/` — the published npm package (wasm-pack output, pnpm workspace member)
- `packages/codemirror/` — CodeMirror 6 Typst editing: WYSIWYG inline preview, highlight, hover, autocomplete
- `packages/typing/` — `@typbase/typing`: workspace/page types shared app <-> storage <-> (later) server
- `packages/storage/` — `@typbase/storage`: OPFS, picked-folder, Tauri, and memory backends plus the Loro doc registry
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

Storage location is a choice, not a fixed directory. The Tauri shell (desktop/mobile) writes
through Rust commands in `platform/tauri/src/storage.rs` to one of: app data (private), the
device documents folder (visible to other apps), or a desktop-picked folder. Browsers use
OPFS, or a folder picked through the File System Access API on Chromium desktop. The choice
is made on first run and can be changed from settings; each location keeps its own workspace
registry. Page sources are mirrored to `sources/<page.path>` so external editors can work on
real `.typ` files; changes are pulled back when the window regains focus. Media lives in a
content-addressed `blobs/<sha256>` tree and is served to Typst as
`/typbase-blob/<hash>.<ext>`. `/debug` has a storage explorer with a workspace view, a raw
file tree, and an Assets tab that previews blobs, copies references, uploads, and prunes
unreferenced files.

`/debug` (linked from the sidebar footer) is a lab for the pipeline: compile arbitrary Typst
against the workspace, check the raw/synth index mapper invariants, run a recovery battery
(broken math, unknown vars, unclosed brackets, self-embeds, 300-paragraph docs), simulate
typing while watching the wasm heap, and reset/wipe the local workspace.

Rendering geometry: panes are measured in CSS pixels and converted to points inside
`TypstState::resize`; the SVG frames each pane renders are sized to it, so inline widgets,
split, and read views all lay out at the width the user sees.

## Plugins

A plugin is a folder with a manifest and Typst sources. No JavaScript ships with a plugin:
the host compiles each surface to HTML, sanitizes it, and renders it into a shadow root
(styles are scoped, scripts and network URLs are stripped), then applies the state patch the
surface returns. Bundled examples live in `public/plugins/`; local plugins live in
`plugins/<name>/` inside the workspace storage, so a desktop user can edit them with any
editor. The plugin lab on `/debug` compiles a surface on demand, dispatches test actions, shows
state, logs, and rendered HTML, edits local sources in place, and forks a bundled plugin into
the storage tree. If the compile worker cannot start, the host falls back to the main-thread
engine and the lab reports why.

```json
{
  "id": "local:calendar",
  "name": "Calendar",
  "version": "0.1.0",
  "api": "typbase.host.v1",
  "entry": "main.typ",
  "icon": "calendar_month",
  "capabilities": ["pages.read", "daily.write", "plugin.data"],
  "collections": {
    "events": {
      "fields": {
        "title": { "type": "string" },
        "date": { "type": "string" },
        "time": { "type": "string", "optional": true }
      }
    }
  },
  "surfaces": [
    { "kind": "sidebar", "fn": "sidebar", "title": "Calendar" },
    { "kind": "main", "fn": "main", "title": "Calendar" }
  ]
}
```

Each surface is an exported Typst function called with one JSON context:
`ctx.state` (declared collections), `ctx.view` (device-local view state), `ctx.action`
(when an action is being reduced), `ctx.data` (pages/categories, gated by capability),
`ctx.today`, `ctx.locale`, and `ctx.config`. The function returns UI plus a hidden patch:

```typst
#import "/typbase-ui.typ": *

#let step(state, action) = {
  if action.name == "note.create" {
    patch-state((op-append("notes", (
      id: action.id,
      text: action.fields.at("text", default: ""),
      x: 20, y: 20, color: "#fff3bf",
    )),))
  } else { none }
}

#let main(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.action) } else { none }
  [
    #patch-holder(patch)
    #button("Add", "note.create")
  ]
}
```

`typbase-ui.typ` provides the controls (button, field, select, grid, board, movable,
canvas) and the patch helpers. Actions are declarative strings like `note.create` or host
actions like `app.open-plugin` / `app.create-daily` / `app.page-append`; the host validates
every patch op against the manifest schema before writing to the plugin's Loro doc, which
syncs like any page. Plugin logic is Typst, and the renderer strips scripts and network URLs
before sanitized HTML reaches the shadow root.

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
