#!/usr/bin/env bash
# Bumps every version source with scripts/release/bump-version.mjs and, unless
# DRY_RUN is true, commits, tags, and pushes the release tag. Writes the new
# version as the `version` step output.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/lib.sh"

require BUMP
dry_run=${DRY_RUN:-false}

repo_root=$(cd "$script_dir/../.." && pwd)
cd "$repo_root"

if [[ "$dry_run" == "true" ]]; then
    version=$(node scripts/release/bump-version.mjs "$BUMP" --dry-run)
else
    version=$(node scripts/release/bump-version.mjs "$BUMP")
fi

set_output version "$version"
echo "Next version: $version"

if [[ "$dry_run" == "true" ]]; then
    exit 0
fi

bash "$script_dir/git-ssh-signing.sh"

sign=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign=(-S)
fi

git add -A
git commit "${sign[@]}" -m "chore: bump version to $version" || echo "No changes to commit"
git tag "${sign[@]}" -a "typbase-v$version" -m "Typbase Release v$version"
git push
git push origin "typbase-v$version"
