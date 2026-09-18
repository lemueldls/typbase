# Typbase

Local-first knowledge base built around the [Typst](https://typst.app) language.

<!-- Pages, daily notes, and plugin surfaces are Typst documents compiled against a small standard library that reads the workspace as data. -->

<!-- Everything runs offline: workspaces live in the browser or on disk, sync through atproto Spaces, and merge with Loro CRDTs. Signing in with an atproto account attaches a Space to a workspace, and publishing writes public records any atproto client can read. -->

## Technologies

### App

- [Nuxt](https://nuxt.com) 5 (nightly), [Vue](https://vuejs.org) 3.5, [Vue Router](https://router.vuejs.org) 5, and [Nitro](https://nitro.build) 3.
- [reka-ui](https://reka-ui.com) primitives behind the shared UI components.

<!-- - [VueUse](https://vueuse.org) composables and [@nuxtjs/i18n](https://i18n.nuxtjs.org) with English, Spanish, French, German, and Chinese locales. -->
<!-- - [material-symbols](https://github.com/marella/material-symbols) icons. -->
<!-- - Theme tokens shared as CSS variables with the Typst renderer palette, so the app chrome and compiled output stay in step. -->

### Editor

- [CodeMirror 6](https://codemirror.net) with Typst syntax highlighting, hover, autocomplete, typst-aware keymaps, and WYSIWYG inline widgets.
- [harper.js](https://writewithharper.com) for optional grammar checking in a worker, alongside the browser's native spellchecker.
- Four view modes: Write (inline WYSIWYG), Split, Source, and Read.

### Engine

- [Typst](https://typst.app) 0.15 compiled to WebAssembly with [wasm-bindgen](https://rustwasm.github.io/docs/wasm-bindgen/) and [wasm-pack](https://github.com/rustwasm/wasm-pack).
- [comemo](https://github.com/typst/comemo) memoization. Each note compiles from several source variants, so error recovery never changes what the IDE and diagnostics read.

<!-- - Plugin views compile through the same engine to HTML, get sanitized, and render into an isolated DOM root with declarative actions. No iframe or messaging bridge. -->
<!-- - Bundled [Maple Mono](https://github.com/subframe7536/maple-font) and New Computer Modern Math fonts, plus system font discovery on desktop. -->

### Storage and data

- [Loro](https://loro.dev) CRDTs: one document for the workspace, one per page, one per plugin instance.
- Storage backends for OPFS, the File System Access API, the Tauri filesystem, and memory. Blobs are content-addressed by SHA-256.

### Search and AI

- [sqlite-wasm-vec](https://github.com/yangbooom/sqlite-wasm-vec): SQLite in WebAssembly over OPFS with full-text and vector search, queried hybrid (BM25 plus cosine, reciprocal rank fusion) from a worker.
- [transformers.js](https://github.com/huggingface/transformers.js) embeddings in a worker with a small default model. Semantic search stays off until enabled and the model is downloaded.

<!-- - Provider-agnostic AI: OpenAI-compatible endpoints, Anthropic, and Ollama behind one interface, with keys kept on the device. -->

### Sync and atproto

- [atproto](https://atproto.com) OAuth with PAR, PKCE, and DPoP; a loopback flow on dev origins and a deep-link flow on desktop.
- [airspace](https://getair.space) for Spaces. The lexicons cover synced documents and published posts.
- Documents sync as Loro updates and periodic snapshots in Space records. Publishing renders a page, uploads the artifacts as blobs, and writes a public post record; a public profile page renders published posts from a read-only client.

### Desktop and mobile

- [Tauri](https://tauri.app) 3 alpha: filesystem storage, system font discovery, deep-link sign-in, updater, and single-instance handling. Custom window chrome is opt-in per device.

### Tooling

- [pnpm](https://pnpm.io) workspaces and [moon](https://moonrepo.dev) tasks; [tsdown](https://tsdown.dev) builds the shared TypeScript packages.
- [oxlint](https://oxc.rs/docs/guide/usage/linter) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for linting and formatting, with [golar](https://golar.dev) for Vue type checking.

## Inspirations

- [Typst](https://typst.app) for the language and compiler, and the idea that documents can be queried as data.
- [Notion](https://www.notion.com) and [Obsidian](https://obsidian.md) for the product shape: daily notes, categories, command palette, backlinks, and plain files on disk.
- [Mnemo](https://github.com/lemueldls/mnemo), an earlier Typst WYSIWYG editor whose editor and WebAssembly engine were extracted into Typbase.
- [Noteworthy](https://github.com/sihooleebd/noteworthy), a Typst framework for educational documents and a reference for Typst-first authoring, study material, and flashcards.
- [The LEAST Private Operating System Ever Created](https://www.youtube.com/watch?v=M_720LesVg4) for reflective systems where everything is inspectable.
- [Dynamic Documents as Personal Software](https://www.youtube.com/watch?v=MccJdr61xnc) for documents that run their own code.
- [PlayBook: A Programmable Paper Notebook](https://www.youtube.com/watch?v=GurWDZ8ENpA) for programmable notebook pages.

<!-- - [Noodle](https://github.com/noodle-run/noodle) and [UNMS research](https://un.ms/research), carried over from Mnemo, for local-first notes and shared-document research. -->
<!-- - The atproto Spaces ecosystem: [comail.at](https://comail.at), [Tangled](https://tangled.org), and atproto calendar apps. Interop over lock-in is why records stay plain and blobs standard. -->

## Development

Prerequisites: Node 26+, pnpm 12+, Rust with the WebAssembly target, and [wasm-pack](https://github.com/rustwasm/wasm-pack). Without Rust, the dev command cannot build the engine and fails.

```sh
pnpm install
pnpm dev
```

- `pnpm build`, `pnpm generate`, and `pnpm preview` handle production output.
- `pnpm lint` and `pnpm fmt:check` are the CI gates.
- `pnpm typecheck` checks the app and the shared packages.

## Releases

Desktop bundles for Linux, macOS, and Windows, a signed Android APK/AAB, and packages for the AUR, Void, and Nix ship from tagged releases. See [RELEASING.md](RELEASING.md) for the flow and the required secrets.

## License

AGPL-3.0. See [LICENSE](LICENSE).
