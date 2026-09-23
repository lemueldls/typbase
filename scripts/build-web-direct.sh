#!/usr/bin/env bash
# Builds the engine, the workspace packages, and the web app without moon.
# Packaging builds (AUR, Void, nix) consume the release tarball, which carries
# no git metadata, and moon reads the VCS revision while running a task.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# wasm-pack fails to re-read its own arrays in pkg/package.json on a cache-miss
# rebuild, so the moon task resets the file first; do the same here.
(cd packages/engine && printf '{}' > pkg/package.json && wasm-pack build --release --target web --scope typbase .)

pnpm --filter @typbase/typing build
pnpm --filter @typbase/storage build
pnpm --filter @typbase/spaces build
pnpm --filter @typbase/codemirror build
pnpm --filter @typbase/web generate
