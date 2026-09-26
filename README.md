# Typbase

Local-first knowledge base made for [Typst](https://typst.app) and the [Atmosphere](https://atproto.com/).

https://github.com/user-attachments/assets/f002f9a0-63b3-43c2-bd1a-ea7ed898fba3

## Features

- **Inline WYSIWYG:** Compiled output replaces the source as you type. Split edit and read views come with it.
- **Notebook pages:** Create a page as a notebook and its source splits into cells on `// %%` markers. Cells render in place and run with a click with execution counters and Jupyter keybindings.
- **The workspace as data:** `#typbase.query`, `#typbase.embed`, `#typbase.page-link`, and `#typbase.section` read pages, categories, daily notes, and sections from inside a document.
- **Plugins written in Typst:** Extend the app with sidebar widgets, panes, and floating windows written in the same language as your notes.
- **Standalone output:** Export HTML, PDF, SVG, or a compilable Typst project. The source mirror is plain `.typ`, and `typst compile --root .` works outside the app.
- **Local-first:** Browser or desktop storage, content-addressed media, and optional sync and live collaboration through atproto Spaces. Publish a page as a public post when you want a URL.

## Technologies

- [Nuxt](https://nuxt.com) 5 (nightly) for the application framework.
- [CodeMirror](https://codemirror.net) 6 for the editor with [Harper](https://writewithharper.com) integration.
- [Typst](https://typst.app) 0.15 compiled to WebAssembly for the engine.
- [Loro](https://loro.dev) CRDTs for collaborative editing.
- [atproto](https://atproto.com) with [airspace](https://getair.space) for storage and sync.
- [sqlite-wasm-vec](https://github.com/yangbooom/sqlite-wasm-vec) and [transformers.js](https://github.com/huggingface/transformers.js) for search.
- [Tauri](https://tauri.app) 3 (alpha) for desktop and mobile builds.
- [pnpm](https://pnpm.io) and [moonrepo](https://moonrepo.dev) for workspace management.

## Inspirations

- [Typst](https://typst.app) for the language and the idea that documents can be queried as data.
- [Notion](https://www.notion.com) and [Obsidian](https://obsidian.md) for the product shape: daily notes, categories, backlinks, and files on disk.
- [Mnemo](https://github.com/lemueldls/mnemo), the earlier Typst WYSIWYG editor whose editor and engine were extracted into Typbase.
- [The LEAST Private Operating System Ever Created](https://www.youtube.com/watch?v=M_720LesVg4) for reflective systems where everything is inspectable.
- [Dynamic Documents as Personal Software](https://www.youtube.com/watch?v=MccJdr61xnc) for documents that run their own code.
- [PlayBook: A Programmable Paper Notebook](https://www.youtube.com/watch?v=GurWDZ8ENpA) for programmable notebook pages.

## Self-Hosting

### Prerequisites

- Node 26+
- pnpm 12+
- Rust with the `wasm32-unknown-unknown` target.

### Development

```sh
pnpm install
pnpm dev
```

### Production

```sh
pnpm install
pnpm build
pnpm preview
```

## Installation

You can download the latest version of the application from the [GitHub Release page](https://github.com/lemueldls/typbase/releases/latest).

### Windows (winget)

Run the following command:

```sh
winget install typbase
```

### Arch Linux (AUR)

Install either the prebuilt package or build-from-source package from AUR:

```sh
# Prebuilt binary package
paru -S typbase-bin

# Or build from source
paru -S typbase
```

### Void Linux

Add the repository and install the package:

```sh
# Add the repository
echo "repository=https://github.com/lemueldls/typbase/releases/latest/download" | sudo tee /etc/xbps.d/typbase-repo.conf

# Install the package
sudo xbps-install -S typbase
```

### Android

Download the APK from the [GitHub Release page](https://github.com/lemueldls/typbase/releases/latest).

Most phones use `arm64-v8a`, older 32-bit devices use `armeabi-v7a`, and emulators use `x86` or `x86_64`.

## Updating

- **Desktop:** Checks at launch and from the "General" settings, installs in place, and restarts. winget installs the same NSIS build and updates the same way.
- **AUR, Void, Nix:** These update through your package manager; the in-app check points there instead.
- **Android APK:** Downloads the build for your device's ABI, verifies its checksum, and opens the system installer. Android asks you to allow installs from the browser or file manager that opens the APK. Typbase asks for the "install unknown apps" permission once, the first time it installs its own update.

<!-- - **Google Play:** Play handles the download and the in-app prompt. -->
<!-- - **Obtainium:** Point it at the [GitHub repository](https://github.com/lemueldls/typbase) and it tracks releases; the in-app check still works. -->

## License

This project is licensed under [AGPL-3.0](https://choosealicense.com/licenses/agpl-3.0/). See the [LICENSE](LICENSE) file for details.
