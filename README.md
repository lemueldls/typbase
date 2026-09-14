# typbase

A local-first knowledge base where Typst is the app's data language and atproto Spaces is the
sync and sharing layer. Write notes in Typst, ask the app for its data from Typst, and extend
the app itself in Typst.

## What it does

- **Everything is Typst.** Pages are `.typ` documents, and Typst can read the workspace:
  `#typbase.query("pages")` returns app data as JSON and `#typbase.embed("<page-id>")`
  includes another page's source. Home pages, note sections, and plugins are written the same
  way as notes.
- **Four editing modes.** Write shows inline previews over the source, Split pairs the editor
  with rendered pages, Source is plain text, and Read is the rendered document.
- **Local-first storage.** Workspaces are Loro CRDT documents kept on your machine. Pick an
  app-private folder, your documents folder, or any folder on desktop; browsers use internal
  storage or a folder you grant. Notes are mirrored as real `.typ` files, so you can edit them
  with your own tools and they come back into the app.
- **Sync and share.** Attach an atproto Space to a workspace for live updates, presence, and
  conflict-free merges. Public notes publish to atproto with rendered HTML.
- **Daily notes and categories.** A daily note system and a home page, with pages grouped by
  category in the sidebar.
- **Media.** Drop images and other files into the editor. They are stored with the workspace,
  referenced from notes, and managed from the storage explorer's Assets tab.
- **Search.** Full-text search with an optional semantic layer that runs local embeddings.
- **Bring your own AI.** OpenAI-compatible providers, Anthropic, or Ollama can generate
  summaries, quizzes, flashcards, and study guides from your notes.
- **Your fonts.** Use installed system fonts for text, math, and code; each picker only offers
  families that fit its purpose.
- **Plugins.** Extend the app with Typst-authored surfaces: sidebar widgets, full panes, and
  floating overlays. Bundled examples include a calendar that reads and writes daily notes,
  flashcards built from sections in your notes, sticky notes that float above any page, and a
  drawing board you can embed in a note. Plugins ship no JavaScript, and local plugins are
  plain folders you can edit.

## Inspirations

Typst is the core of the data model: markup, logic, and UI all use one language. The
interaction model borrows from Notion and Obsidian: pages, daily notes, categories, a home
page, and a command palette. The editor stack started as the mnemo project, a WYSIWYG Typst
editor built on CodeMirror. Sync and sharing use atproto Spaces, with the goal of reading and
writing data from other space apps such as comail.at, tangled, and atproto calendars.
