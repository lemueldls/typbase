# @typbase/storage

Local-first storage for Typbase.

- OPFS, picked-folder, Tauri filesystem, and memory backends.
- The workspace Loro document registry, page documents, and chat documents.
- The source mirror that keeps `.typ` files in sync with the workspace.
- The content-addressed blob store, with 16-character addresses and full
  SHA-256 verification.
- Device-local state in `local.json`.
