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

# The bump workflow already wrote <version> into the derivations, so asking
# nix-update for that version would treat it as unchanged and skip the hashes
# too. `skip` updates only the hashes, which is what a release needs.
nix-update --flake --version=skip --build typbase
nix-update --flake --version=skip --build typbase-bin

sign=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign=(-S)
fi

git add -A
git commit "${sign[@]}" -m "chore: update nix flake to $version" || echo "No changes to commit"
git push
