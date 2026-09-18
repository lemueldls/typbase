#!/usr/bin/env bash
# Regenerates the PKGBUILD for <name>, builds it, and pushes it to the AUR.
# Assumes aur-setup-ssh.sh already installed AUR_DEPLOY_KEY. Run as the
# unprivileged build user.
set -euo pipefail

name=${1:-}
generator=${2:-}
version=${3:-}
sha256=${4:-}
if [[ -z "$name" || -z "$generator" || -z "$version" || -z "$sha256" ]]; then
    echo "Usage: $0 <name> <generator> <version> <sha256>" >&2
    exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ ! -f "$generator" ]]; then
    generator="$repo_root/$generator"
fi

work=${AUR_WORKDIR:-"$HOME/aur"}
if [[ ! -d "$work/.git" ]]; then
    if ! git clone --depth=1 "ssh://aur@aur.archlinux.org/$name.git" "$work"; then
        echo "Could not clone the AUR repo for $name. Set AUR_DEPLOY_KEY and create $name on aur.archlinux.org first." >&2
        exit 1
    fi
fi

cd "$work"

if [[ -f PKGBUILD ]]; then
    # pkgver comes from the PKGBUILD.
    # shellcheck disable=SC2154
    current=$(source PKGBUILD && echo "$pkgver")
    if [[ "$current" == "$version" ]] ||
        [[ "$(printf '%s\n%s' "$current" "$version" | sort -V | head -n1)" != "$current" ]]; then
        echo "New version $version is not higher than $current; nothing to do."
        exit 0
    fi
fi

"$generator" "$version" "$sha256" > PKGBUILD

if [[ -z "$(git status --porcelain)" ]]; then
    echo "No changes"
    exit 0
fi

makepkg --printsrcinfo > .SRCINFO
makepkg
makepkg --install --noconfirm

git config user.name "${AUR_GIT_NAME:-lemueldls}"
git config user.email "${AUR_GIT_EMAIL:-aur@lemueldls.dev}"
git add PKGBUILD .SRCINFO
git commit -m "New upstream release $version"
git push origin master
