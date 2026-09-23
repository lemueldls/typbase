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

# One generated section per release from conventional commits (.cliff.toml).
# Older sections are kept verbatim, so hand edits (and the first release's
# curated list) survive. The intro above the first `## [` belongs to the file,
# so the section is composed under it instead of using --prepend, which would
# insert above the intro when the config has no header.
if [[ -f CHANGELOG.md ]]; then
    section=$(mktemp)
    merged=$(mktemp)
    git_cliff --config .cliff.toml --unreleased --tag "$tag" --strip header -o "$section"
    awk '/^## \[/ { exit } { print }' CHANGELOG.md > "$merged"
    cat "$section" >> "$merged"
    awk '/^## \[/ { found = 1 } found' CHANGELOG.md >> "$merged"
    mv "$merged" CHANGELOG.md
    rm -f "$section"
else
    git_cliff --config .cliff.toml --tag "$tag" -o CHANGELOG.md
fi

# A release can legitimately be chore-only, so this warns instead of failing.
if ! awk '
    /^## \[/ { sections++; next }
    sections == 1 && /^- / { entries = 1 }
    END { exit entries ? 0 : 1 }
' CHANGELOG.md; then
    echo "warning: CHANGELOG.md has no entries for $version; the release notes will be empty" >&2
fi

bash "$script_dir/git-ssh-signing.sh"

sign_commit=()
sign_tag=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign_commit=(-S)
    # `git tag` signs with -s; -S is only a `git commit` flag.
    sign_tag=(-s)
fi

git add -A
git commit "${sign_commit[@]}" -m "chore: bump version to $version" || echo "No changes to commit"
git tag "${sign_tag[@]}" -a "$tag" -m "Typbase Release v$version"
git push
git push origin "$tag"
