#!/usr/bin/env bash
# Updates both flake derivations to <version>, builds them, and pushes the
# change. Signing follows SSH_SIGNING_KEY through git-ssh-signing.sh.
set -euo pipefail

version=${1:-}
[[ -n "$version" ]] || {
    echo "Usage: $0 <version>" >&2
    exit 1
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
cd "$repo_root"

bash "$script_dir/git-ssh-signing.sh"

nix-update --flake --version "$version" --build typbase
nix-update --flake --version "$version" --build typbase-bin

sign=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign=(-S)
fi

git add -A
git commit "${sign[@]}" -m "chore: update nix flake to $version" || echo "No changes to commit"
git push
