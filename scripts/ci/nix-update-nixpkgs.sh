#!/usr/bin/env bash
# Copies the derivation into NIXPKGS_FORK, updates it to <version>, and opens a
# pull request. Skips when NIXPKGS_FORK or NIXPKGS_TOKEN is missing.
set -euo pipefail

version=${1:-}
[[ -n "$version" ]] || {
    echo "Usage: $0 <version>" >&2
    exit 1
}

if [[ -z "${NIXPKGS_FORK:-}" || -z "${NIXPKGS_TOKEN:-}" ]]; then
    echo "NIXPKGS_FORK or NIXPKGS_TOKEN is not set; skipping the nixpkgs PR."
    exit 0
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)

work=${NIXPKGS_DIR:-"$repo_root/nixpkgs"}
if [[ -e "$work" ]]; then
    echo "$work already exists; remove it first." >&2
    exit 1
fi

git clone --depth=1 "https://x-access-token:${NIXPKGS_TOKEN}@github.com/${NIXPKGS_FORK}.git" "$work"
cd "$work"
git remote add upstream https://github.com/NixOS/nixpkgs.git
git fetch --depth=1 upstream master
git reset --hard upstream/master
git checkout -b "typbase-$version"

mkdir -p pkgs/by-name/ty/typbase
cp "$repo_root/nix/nixpkgs/typbase.nix" pkgs/by-name/ty/typbase/package.nix

# The derivation already carries <version> (the bump workflow writes it), so
# nix-update would skip the hash updates along with the version. `skip` updates
# only the hashes.
nix-update --version=skip --build typbase

git config user.name "lemueldls"
git config user.email "noreply@git.lemueldls.dev"
git add pkgs/by-name/ty/typbase
git commit -m "typbase: update to $version"
git push -u origin "typbase-$version"

export GH_TOKEN="$NIXPKGS_TOKEN"
pr_head="${NIXPKGS_FORK%%/*}:typbase-$version"

if gh pr list --repo NixOS/nixpkgs --head "$pr_head" --json number --jq '.[0].number' | grep -q .; then
    echo "A pull request for this version already exists."
    exit 0
fi

gh pr create \
    --repo NixOS/nixpkgs \
    --base master \
    --head "$pr_head" \
    --title "typbase: update to $version" \
    --body "Automated update from the typbase release workflow.

Release: https://github.com/lemueldls/typbase/releases/tag/typbase-v$version"
