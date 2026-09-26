# Changelog

## [0.2.3] - 2026-09-26

### New

- Add update management system

### Fixed

- Native mobile app design
- Calendar translations

## [0.2.2] - 2026-09-25

### New

- Add editor display options
- Initial page graph and backlinks

### Fixed

- App name spelling
- Remove scopes style

## [0.2.1] - 2026-09-24

### Fixed

- Bump the engine lock entry and keep the wasm-bindgen pin

## [0.2.0] - 2026-09-24

### New

- Publish releases to winget

### Fixed

- Build the frontend without moon
- Push the release commit as HEAD:master
- Build the 0.1.1 xbps
- Build the frontend in the sandbox and fill the 0.1.1 hashes
- Icon url
- Set default raw lang in prelude
- Error recovery for unmappable blocks and diagnostics

## [0.1.1] - 2026-09-23

First release. Typbase keeps a workspace of Typst files on your device, edits
them with an inline WYSIWYG preview, and reads its own data through Typst.

### New

- Local-first workspaces on OPFS, a picked folder, or the desktop filesystem
- CodeMirror editor with inline preview, split, source, and read modes
- Paged Typst preview from the wasm engine, with error recovery while typing
- Notebook pages: `// %%` markup and code cells with live output
- Search palette with optional semantic (embedding) search
- Daily notes, categories, a home page, and workspace switching
- Themes with light and dark seeds and custom palettes; UI size, density, and radius
- Bundled and system fonts, including math fonts
- Assets stored by content hash and embedded in notes
- Exports to HTML, PDF, page SVGs, and a compilable Typst project
- Typst Universe package browser
- Typst-authored plugins with sidebar, main, and overlay surfaces
- atproto Spaces sync, publishing, and blob upload
- AI chat grounded in the workspace, plus AI actions for plugins
- Spellcheck through the browser or Harper, with a synced personal dictionary
- Desktop (Linux, macOS, Windows), Android, and web builds

### Fixed

- Daily notes and navigation
- Editor width, text scaling, and heading line heights
- Workspace loading and source resolution
- Mobile editing and the mobile search sheet
- Search indexing and semantic model loading
- Sidebar and editor formatting
- Preview spacing for lists, headings, and paragraphs
- Autocomplete and hover inside recovered ranges
- Error recovery for empty attachments, degenerate tooltips, and broken delimiters
- Notebook auto-run and cell splitting
- Link editing and the page actions menu
