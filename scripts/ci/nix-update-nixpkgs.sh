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

branch="typbase-$version"
export GH_TOKEN="$NIXPKGS_TOKEN"
pr_head="${NIXPKGS_FORK%%/*}:$branch"

if gh pr list --repo NixOS/nixpkgs --head "$pr_head" --json number --jq '.[0].number' | grep -q .; then
    echo "A pull request for this version already exists."
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

if [[ ! -f pkgs/by-name/ty/typbase/package.nix ]]; then
    echo "typbase is not in nixpkgs yet; skipping the update PR."
    exit 0
fi

old_version=$(sed -n 's/^  version = "\([^"]*\)";$/\1/p' pkgs/by-name/ty/typbase/package.nix)
[[ -n "$old_version" ]] || {
    echo "Could not read the current typbase version." >&2
    exit 1
}

if [[ "$old_version" == "$version" ]]; then
    echo "nixpkgs already has typbase $version."
    exit 0
fi

git checkout -b "$branch"
cp "$repo_root/nix/nixpkgs/typbase.nix" pkgs/by-name/ty/typbase/package.nix

nix-update --version=skip --build typbase

git config user.name "lemueldls"
git config user.email "noreply@git.lemueldls.dev"
git add pkgs/by-name/ty/typbase
git commit \
    -m "typbase: $old_version -> $version" \
    -m "https://github.com/lemueldls/typbase/releases/tag/typbase-v$version"
git push --force origin "HEAD:refs/heads/$branch"

body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT

cat >"$body_file" <<EOF
https://github.com/lemueldls/typbase/releases/tag/typbase-v$version

## Things done

- [x] Fits [CONTRIBUTING.md], [pkgs/README.md], [maintainers/README.md] and other READMEs.
- [x] Follows the [automation/AI policy].
- Built on platform:
  - [x] x86_64-linux
  - [ ] aarch64-linux
  - [ ] aarch64-darwin
- Tested, as applicable:
  - [x] Basic functionality of all binary files, usually in \`./result/bin/\`.
  - [ ] Ran \`nixpkgs-review\` on this PR. See [nixpkgs-review usage].
  - [ ] [Package tests] at \`passthru.tests\`.
  - [ ] [NixOS tests] in [nixos/tests].
  - [ ] Tests in [lib/tests] or [pkgs/test] for functions and "core" functionality.
- Nixpkgs Release Notes
  - [ ] Package update: when the change is major or breaking.
- NixOS Release Notes
  - [ ] Module addition: adding a new NixOS module.
  - [ ] Module update: when the change is significant.
EOF

gh pr create \
    --repo NixOS/nixpkgs \
    --base master \
    --head "$pr_head" \
    --title "typbase: $old_version -> $version" \
    --body-file "$body_file"
