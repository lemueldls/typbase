#!/usr/bin/env bash
# Prints the CHANGELOG.md section for a release tag. The changelog committed at
# the tag is the source of truth for the GitHub release body, so a tag without
# a section fails here instead of shipping an empty release.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/lib.sh"

require TAG
require VERSION

repo_root=$(cd "$script_dir/../.." && pwd)

# Reads to EOF after the section ends; an early exit would close git show's
# pipe under pipefail.
git -C "$repo_root" show "$TAG:CHANGELOG.md" |
    awk -v heading="## [$VERSION]" '
        found && /^## \[/ { done = 1 }
        !found && index($0, heading) == 1 { found = 1 }
        found && !done { print }
        END { if (!found) exit 1 }
    ' ||
    die "CHANGELOG.md at $TAG has no section for $VERSION"
