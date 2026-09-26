#!/usr/bin/env bash
# Updates both flake derivations to <version>, builds them, and pushes the
# change. Signing follows SSH_SIGNING_KEY through git-ssh-signing.sh.
set -euo pipefail

version=${1:-}
branch=${BRANCH:-main}
[[ -n "$version" ]] || {
    echo "Usage: $0 <version>" >&2
    exit 1
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
cd "$repo_root"

bash "$script_dir/git-ssh-signing.sh"

sign=()
if [[ -n "${SSH_SIGNING_KEY:-}" ]]; then
    sign=(-S)
fi

attempts=${PUSH_ATTEMPTS:-3}
for attempt in $(seq 1 "$attempts"); do
    git fetch origin "$branch"
    git reset --hard "origin/$branch"

    # The bump workflow already wrote <version> into the derivations, so asking
    # nix-update for that version would treat it as unchanged and skip the hashes
    # too. `skip` updates only the hashes, which is what a release needs.
    nix-update --flake --version=skip --build typbase
    nix-update --flake --version=skip --build typbase-bin

    git add -A
    if git diff --cached --quiet; then
        echo "flake already matches $branch"
        exit 0
    fi

    git commit "${sign[@]}" -m "chore: update nix flake to $version"

    if git push origin "HEAD:$branch"; then
        exit 0
    fi

    echo "push to $branch was rejected; retrying against the new HEAD" >&2
    sleep $((attempt * 10))
done

echo "could not push the flake update after $attempts attempts" >&2
exit 1
