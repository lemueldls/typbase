# Writing a plugin

A plugin is a folder of Typst and CSS plus a `plugin.json`. The host compiles
its surfaces to sandboxed HTML, wires interactions back as actions, and stores
the plugin's records in a Loro doc that syncs like a page.

## Where plugins live

- Bundled plugins ship in `apps/web/public/plugins/<slug>/` and are always in
  the catalog.
- Local plugins live in `plugins/<slug>/` inside the workspace storage root.
  Import a folder from the plugin manager, create one in the studio, or write
  the files by hand; the storage watcher picks up external edits where the
  backend supports it (Tauri, picked folder).
- `plugins/` is a reserved root: its `.typ` files are plugin sources, never
  pages.

```
plugins/my-plugin/
  plugin.json    manifest
  main.typ       entry module
  style.css      optional, injected into the surface shadow root
```

## Manifest

```json
{
  "id": "local:my-plugin",
  "name": "My plugin",
  "version": "0.1.0",
  "description": "What it does.",
  "api": "typbase.host.v2",
  "entry": "main.typ",
  "icon": "extension",
  "capabilities": ["plugin.data"],
  "collections": {
    "notes": {
      "fields": {
        "text": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" }
      }
    }
  },
  "hostComponents": ["canvas"],
  "surfaces": [
    { "kind": "widget", "fn": "widget", "title": "My plugin", "icon": "extension" },
    { "kind": "pane", "fn": "pane", "title": "My plugin", "icon": "extension" },
    { "kind": "window", "fn": "window", "title": "My plugin", "icon": "extension" }
  ]
}
```

- `api` is exactly `typbase.host.v2`. v1 manifests are rejected.
- `surfaces` declares at most one `widget` (sidebar), `pane` (main area), and
  `window` (floating window) per plugin. Every instance of the plugin renders
  all of them from the same data.
- `collections` declares the fields a patch may write. `id` is reserved and
  never listed.
- `hostComponents` lists the host-owned components the surfaces mount, today
  `canvas`.

Installing a plugin creates one instance. A second instance is an independent
copy with its own data doc; both sync to atproto like pages. The plugin
manager renames instances; the new name shows in the sidebar, the window
title, and `ctx.instance.title`. A `window` instance also gets a host-chrome
close and drag; a `pane` instance opens from the sidebar row.

## A surface

A surface function receives `ctx` and returns `surface(ui, state, view)`; `ui`
is the content and the other two are patch fields:

```typst
#import "/typbase/ui.typ": *

#let step(state, view, action, ctx) = {
  if action.name == "note.bump" {
    ops-view((count: view.at("count", default: 0) + 1))
  } else {
    (:)
  }
}

#let pane(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }

  surface(
    [
      #panel(title: "Counter", body: [
        #muted(body: "Count: " + str(ctx.view.at("count", default: 0)))
        #button("Bump", action: "counter.bump", kind: "primary")
      ])
    ],
    ..patch,
  )
}
```

- `state` ops mutate the synced plugin doc. `view` merges into device-local
  state (open month, brush color, revealed card) that never syncs.
- The host applies the patch and renders the surface once more without an
  action, so a step function only describes the change.
- Plugin actions that do not start with `app.` or `ai.` come back to the
  surface as `ctx.action`. Host actions return `ctx.result`
  (`action`, `ok`, `message`, `data`) on the follow-up render.
- Fields inside `#form(...)` are collected into `action.fields`; a standalone
  field sends only its own value.

## Context

`ctx` is JSON at `/typbase/plugin/ctx.json`:

| Key                      | Contents                                                  |
| ------------------------ | --------------------------------------------------------- |
| `plugin`                 | `id`, `name`, `version`                                   |
| `instance`               | `id`, `title`                                             |
| `surface`                | `kind`, `title` of the surface being rendered             |
| `state`                  | collection name to records, from the instance doc         |
| `view`                   | device-local state                                        |
| `action` / `result`      | the action being rendered, and the host action result     |
| `config`                 | per-instance config JSON                                  |
| `page`                   | the open page id, gated by `pages.read`                   |
| `data`                   | pages, categories, and daily pages, gated by `pages.read` |
| `theme`                  | resolved palette tokens under camelCase names             |
| `locale`, `now`, `today` | render environment                                        |

`ctx.theme` carries the workspace palette (`text`, `textSecondary`, `accent`,
`accentSoft`, `surface`, `surface2`, `red`, `orange`, `yellow`, `green`,
`cyan`, `blue`, `violet`, `code`, ...) as hex strings. Use it for values that
leave Typst, like canvas stroke colors; the CSS variables below cover the rest.

## `ui.typ`

| Helper                                                                                         | Notes                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface(ui, state, view)`                                                                     | the return value                                                                                                                                                              |
| `ops-state` / `ops-view` / `ops-both`                                                          | patch builders                                                                                                                                                                |
| `button(label, action: ..., actions: ..., args: ..., kind: ..., selected: ..., disabled: ...)` | `kind` is `default`, `primary`, `danger`, or `ghost`; `actions` chains host actions. Typst cannot bind optional parameters positionally, so name every argument after `label` |
| `swatch(color, action, args, selected, label)`                                                 | color chip; set the color with `--tb-swatch`                                                                                                                                  |
| `icon(name, size)`                                                                             | Material Symbols ligature                                                                                                                                                     |
| `field` / `textarea` / `select` / `checkbox` / `form`                                          | inputs; `#form` scopes field collection                                                                                                                                       |
| `panel` / `card` / `stack` / `row` / `grid` / `toolbar` / `badge` / `muted` / `empty`          | layout                                                                                                                                                                        |
| `board` / `movable` / `draggable` / `droppable`                                                | drag components; `movable` sends x/y on drop                                                                                                                                  |
| `canvas(action, strokes, color, width, height)`                                                | drawing surface; requires the `canvas` host component                                                                                                                         |
| `op-append` / `op-set` / `op-merge` / `op-inc` / `op-remove`                                   | state ops                                                                                                                                                                     |
| `ai-complete` / `ai-stream`                                                                    | AI calls; `format: "typst"` runs the dialect check                                                                                                                            |

`#import "/typbase/lib.typ" as typbase` gives the note stdlib, so a plugin can
call `typbase.query(...)` and `typbase.embed(...)`; the host answers requests
like it does for pages. `plugin-data` queries are scoped to the calling
plugin.

## Styling

Host styles live in `apps/web/src/lib/plugins/surface.css` and cover the
primitives above. A plugin's `style.css` is injected after them and can
override anything. Theme variables inherit through the shadow boundary:
`--color-*`, `--font-*`, `--text-*`, `--space-*`, `--radius-*`, `--control-*`,
`--pane-header-height`.

Prefer the variables over hardcoded colors so a theme switch applies without a
recompile. The surface CSS already handles this; a plugin stylesheet only
needs rules for its own classes.

The host wraps the UI in `.tb-surface` and spaces its top-level blocks with
`--space-3`. `ui.typ`'s layout helpers cover everything else: `stack(body: ...,
gap: ...)` and `row(body: ..., gap: ...)` set a flex `gap`, `grid(columns,
body: ..., gap: ...)` sets a grid one, and `toolbar(body: ...)` groups controls
tightly. Use them for inner groups; the top-level spacing is the host's.

## Host actions

| Action                                 | Capability                  | Effect                                          |
| -------------------------------------- | --------------------------- | ----------------------------------------------- |
| `app.open-page`                        | `pages.read`                | open a page by id                               |
| `app.create-page`                      | `pages.create`              | create a page and open it                       |
| `app.create-daily`                     | `daily.write`               | create/open a daily note                        |
| `app.page-append`                      | `pages.write`               | append text to a page (or daily date) and toast |
| `app.open-plugin`                      | -                           | open an instance: pane or window                |
| `app.link`                             | `pages.read`, `ui.external` | route `typbase://` and external links           |
| `app.toast`                            | -                           | show a toast (`message`, `tone`)                |
| `app.window-open` / `app.window-close` | -                           | show or hide the instance's window              |
| `ai.complete` / `ai.stream`            | `plugin.ai`                 | AI calls                                        |

`button(actions: ((name: "app.page-append", args: (:)), (name: "app.window-close")))`
runs several in order from one click.

## Windows

A `window` surface renders inside a host-managed floating window: the host
draws the frame, handles dragging, resizing, stacking, and closing, and stores
the geometry in device-local state. Plugin code never positions fixed
elements.

## Embedding in notes

Notes import a plugin module through the normal Typst channel:

```typst
#import "/typbase/plugin/my-plugin/main.typ": embed
#embed("<instance-id>")
```

The host serves plugin modules under `/typbase/plugin/<slug>/`, so the same
sources compile in the app and in the generated project.

## The studio

`/plugins` (also reachable from the plugin manager) edits local plugins:
file list, Typst editor, manifest validation, live preview per surface, an
action dispatcher, state/view inspection, and per-plugin logs. Compile errors
that map into a plugin file carry `file:line` and open that file at the line.
Bundled plugins are read-only until forked into `plugins/<slug>/`.
