# Demo assets

How to produce the screenshots and GIFs used in the README, posts, and talks.

The one rule: **every image should show Typst source and rendered output in the
same frame.** Without that, Typbase looks like any notes app. The novelty is
that the document is the program.

Plugins are work in progress and deliberately not part of the demo yet.

## Seed workspace

The capture script builds this workspace itself (`scripts/demo/seed.mjs`), so
the content here is documentation, not a manual checklist.

Category `reading`.

`Home` (document, set as home page):

```typst
= Reading log

A home page that reads the workspace. The lists below come from
`#typbase.query`.

== Reading
#let reading = typbase.query("pages", filter: "by-category/reading")

#for page in reading [
  - #typbase.page-link(page.id)
]

== Recent days
#let daily = typbase.query("daily")

#for note in daily.rev().slice(0, 4) [
  - #typbase.page-link(note.id)
]
```

`Attention` (notebook, category `reading`):

```typst
// %% [markup]
= Attention, from scratch

Scaled dot-product attention:

$ "Attention"(Q, K, V) = op("softmax")((Q K^top) / sqrt(d_k)) V $

// %% [code]
#let rows = ((1, 1), (2, 3), (3, 6), (4, 10), (5, 15))

#for (k, total) in rows [
  #box(width: total * 0.35cm, height: 0.45cm, fill: theme.accent, radius: 2pt)
  #h(0.3em) #k: #total
  #linebreak()
]

// %% [markup]
== Why divide by sqrt(d_k)?

The dot products grow with the dimension, so the softmax saturates.
Scaling keeps the gradients usable.
```

Three daily notes, one with a line of prose so the list is not empty. Headings
keep a blank line above and below in the source; the compiled output carries
that spacing and it reads better in the stills.

## Shots

Automated by `scripts/demo/capture.mjs` into `docs/images/`:

| File                | App state                                                                                                              | Theme and sizing                          | What it proves                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `notebook-hero.png` | Notebook mode on `Attention`, sidebar open, mode tabs visible. Rendered math, the bar output, a run counter on a cell. | default, light                            | The whole product in one image: Typst, cells, rendered output, app chrome. |
| `query-split.png`   | Split mode on `Home`. Source left showing `#typbase.query`, rendered page list right.                                  | catppuccin, dark, small, compact, square  | Documents query the app while they compile. The most novel shot.           |
| `wysiwyg.png`       | Write mode, cursor inside a paragraph so that block shows source and its neighbors render.                             | evergarden, light, large, spacious, round | Inline WYSIWYG, not a side preview, plus the sizing system.                |

Manual shots:

| File          | App state                                                                                                                  | What it proves                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `publish.png` | Signed-out browser on the public page, URL bar visible.                                                                    | Publishing is public, readers need no account. Needs a real account. |
| `export.png`  | Export dialog with the project checked, plus a terminal after `typst compile` on the exported bundle. Two-panel composite. | Standalone output, no lock-in.                                       |
| sync GIF      | Two windows side by side, presence cursors in both.                                                                        | Live collaboration. Needs two signed-in sessions in one Space.       |

Captions:

- "Notebook pages are Typst documents. Cells render in place; run them when you want."
- "Your documents read the workspace while they compile."
- "Edit rendered Typst in place. Move the cursor and the source comes back."
- "Publish writes a public record. Readers need no account."
- "Export a compilable project. Plain `.typ` all the way down."

## Hero video

`scripts/demo/hero.mjs` records one unbroken walkthrough (notebook mode
excluded on purpose) into `docs/video/hero.mp4`, plus
`docs/images/hero-poster.png` for the README link. Scenes: title card, home
page in split view, sidebar navigation, editing the Fibonacci example, document
completion, hovering the computed bindings, math tooltips, an inline show rule,
broken math healing while typing, source and read views, theme switch, daily
note, and the export dialog.

Search is left out: the palette opens but the index never returns results in
the scripted browser. Worth investigating separately.

## GIFs

Recorded by `scripts/demo/clips.mjs` into `docs/images/*.gif`, with mp4 copies
in `docs/video/` for posts. All of them are under 2 MB except the completion
clips:

| Clip                  | What it shows                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `typing.gif`          | Typing into a rendered paragraph, then letting it render again.         |
| `notebook-run.gif`    | Run a cell, then edit it and watch the output follow along.             |
| `click-to-source.gif` | Clicking rendered blocks to jump into their source.                     |
| `fibonacci.gif`       | The Typst README example, edited live: count 8 to 12, table recomputes. |
| `autocomplete.gif`    | `#fib` completes from the document, then computes.                      |
| `hover.gif`           | Hover info on a built-in, a local function, and a math symbol.          |
| `recovery.gif`        | Unclosed math while typing: the document keeps rendering, then heals.   |
| `rules.gif`           | An inline show rule restyles the document as it is typed.               |
| `math-tooltip.gif`    | The caret inside math shows the rendered symbol (Write mode only).      |
| `math-completion.gif` | Property access completion: `arrow.r` and `phi.alt` on the lens page.   |

## Capture setup

- Fresh workspace in a throwaway browser profile, so no real titles leak into
  the sidebar.
- 1280x800 viewport at device scale factor 2. A smaller frame at the same pixel
  density makes the chrome and text fill more of the image, which reads better
  when the assets are scaled down. Same size for every shot.
- Each shot runs in a different theme and sizing preset, listed in the table
  above. That is the app's own theme system, not a per-shot override.
- Bundled fonts only.
- Clean state: no diagnostics in the gutter, no spellcheck underlines, no
  selection highlight except where intentional, no tooltips, mouse off-window.
  The formatting strip is collapsed for the stills.

## Automation

`scripts/demo/capture.mjs` (stills) and `scripts/demo/clips.mjs` (GIFs and
mp4s) drive Chromium through Playwright:

```sh
pnpm dev
pnpm exec playwright install chromium
node scripts/demo/capture.mjs [--only=notebook-hero]
node scripts/demo/clips.mjs [--only=typing]
```

1. Launch a fresh context at 1280x800, deviceScaleFactor 2, and collapse the
   formatting strip.
2. Seed the `Demo` workspace before the app ever loads: a blank document on the
   app's origin imports `@typbase/storage` from the Vite dev server, builds the
   workspace through `WorkspaceStore`, writes it into OPFS, and registers it in
   `workspaces.json`. The app then boots straight into it, with no welcome
   workspace and no storage chooser.
3. For each shot, apply the theme settings through `window.__typbase.store`,
   navigate in-app with `window.__typbase.openPage` / `setMode` (no reload, so
   the settings stay in memory), wait for fonts, compile, and the settle
   conditions below, stage the cursor, and screenshot.
4. Record the clips the same way, with a fake pointer overlay and Playwright
   video, then trim to the action window and convert with ffmpeg (GIF via a
   palette pass, plus an mp4). Raw webm files stay in `/tmp/opencode/demo-video`.

The dev-only test handle (`apps/web/src/lib/testApi.ts`) exposes the active
store, the editor view, and the page/mode navigation. Production builds never
assign it. It also backs the e2e suite (`pnpm test:e2e`, `apps/web/e2e/`),
which boots its own dev server and covers boot, text persistence, notebook cell
runs, and diagnostics.

Settle conditions used by the script:

- app shell: sidebar page list is present
- editor: `.cm-editor` exists and `document.fonts.ready` resolved
- render: no `.paged-preview__status` and at least one `svg` in the pane
- notebook output: a `.tb-cell-output` block is present for the run cell
- clean gutter: no `.cm-lintRange-error` or `.cm-lintRange-warning`

Requirements: `playwright` and its Chromium build, plus `ffmpeg` for video
conversion. Clip recordings need the completion popup to open before the script
accepts an item, so the clip scripts pause briefly after typing; a real session
is snappier because the WYSIWYG plugin compiles on every keystroke. The publish and sync shots stay manual because they need a real
atproto account and a shared Space.

Assets go to `docs/images/` with descriptive names, run through `oxipng` or
`pngquant`, and referenced from the README with relative paths so clones get
them too.
