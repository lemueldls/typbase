#!/usr/bin/env bash
# Builds the xbps package from the generated template and signs the repository
# when XBPS_REPOSITORY_SIGNING_KEY is set. Runs inside the Void Linux container.
set -euo pipefail

version=${VERSION:-}
sha256=${SHA256:-}
if [[ -z "$version" || -z "$sha256" ]]; then
    echo "Usage: VERSION=<version> SHA256=<sha256> $0" >&2
    exit 1
fi
app_url=${APP_URL:-https://typbase.at}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
void_packages=${VOID_PACKAGES:-"$HOME/void-packages"}

if [[ ! -d "$void_packages/.git" ]]; then
    git clone --depth=1 https://github.com/void-linux/void-packages.git "$void_packages"
fi

cd "$void_packages"
# The container rootfs is the masterdir; ethereal mode skips the chroot init check.
ln -sf / masterdir
mkdir -p hostdir
cp -a "$HOME/.cargo" "$HOME/.rustup" hostdir/

mkdir -p srcpkgs/typbase
bash "$repo_root/scripts/distro/void/generate-template.sh" \
    "$version" \
    "$sha256" \
    "$app_url" \
    > srcpkgs/typbase/template

xlint srcpkgs/typbase/template
./xbps-src -I fetch typbase

cp "$repo_root/scripts/distro/void/tauri.sh" common/build-style/
./xbps-src pkg typbase

if [[ -z "${XBPS_REPOSITORY_SIGNING_KEY:-}" ]]; then
    echo "XBPS_REPOSITORY_SIGNING_KEY is not set; skipping signing."
    exit 0
fi

printf '%s\n' "$XBPS_REPOSITORY_SIGNING_KEY" > private.pem
xbps-rindex --privkey private.pem --sign --signedby "void@lemueldls.dev" hostdir/binpkgs
xbps-rindex --privkey private.pem --sign-pkg hostdir/binpkgs/*.xbps
