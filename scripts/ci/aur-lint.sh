#!/usr/bin/env bash
# Generates a PKGBUILD with <generator> and runs the namcap/makepkg checks on
# it. Run as the unprivileged build user.
set -euo pipefail

generator=${1:-}
version=${2:-}
sha256=${3:-}
if [[ -z "$generator" || -z "$version" || -z "$sha256" ]]; then
    echo "Usage: $0 <generator> <version> <sha256>" >&2
    exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ ! -f "$generator" ]]; then
    generator="$repo_root/$generator"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

"$generator" "$version" "$sha256" > "$work/PKGBUILD"
cd "$work"
bash "$repo_root/scripts/distro/aur/makepkg-lint.sh"
