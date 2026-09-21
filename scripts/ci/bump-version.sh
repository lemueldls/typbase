#!/usr/bin/env bash
# Bumps every version source with scripts/release/bump-version.mjs and, unless
# DRY_RUN is true, regenerates CHANGELOG.md, commits, tags, and pushes the
# release tag. Writes the new version as the `version` step output.
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

tag="typbase-v$version"

# The changelog is generated, not maintained by hand: one section per release
# from conventional commits (.cliff.toml). Regenerating the whole file from the
# tags keeps the run idempotent; --prepend duplicates the header when the
# existing text drifts from the template.
git_cliff --config .cliff.toml --tag "$tag" -o CHANGELOG.md

# A release can legitimately be chore-only, so this warns instead of failing.
if ! awk '
    /^## \[/ { sections++; next }
    sections == 1 && /^- / { entries = 1 }
    END { exit entries ? 0 : 1 }
' CHANGELOG.md; then
    echo "warning: CHANGELOG.md has no entries for $version; the release notes will be empty" >&2
fi

bash "$script_dir/git-ssh-signing.sh"

sign=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign=(-S)
fi

git add -A
git commit "${sign[@]}" -m "chore: bump version to $version" || echo "No changes to commit"
git tag "${sign[@]}" -a "$tag" -m "Typbase Release v$version"
git push
git push origin "$tag"
