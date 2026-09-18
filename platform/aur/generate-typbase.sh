#!/usr/bin/env bash

version=$1
sha256sum=$2

if [[ -z "$version" || -z "$sha256sum" ]]; then
    echo "Usage: $0 <version> <sha256sum>" >&2
    exit 1
fi

cat <<EOF
# Maintainer: Lemuel De Los Santos <aur@lemueldls.dev>
pkgname=typbase
pkgver=$version
pkgrel=1
pkgdesc="Local-first knowledge base built around the Typst language."
arch=('x86_64')
url="https://github.com/lemueldls/typbase"
license=('AGPL-3.0')
depends=('cairo' 'desktop-file-utils' 'gdk-pixbuf2' 'glib2' 'gtk3' 'hicolor-icon-theme' 'libsoup3' 'pango' 'webkit2gtk-4.1' 'openssl')
makedepends=('cargo' 'nodejs' 'pnpm' 'git' 'file' 'appmenu-gtk-module' 'libappindicator-gtk3' 'librsvg' 'base-devel' 'curl' 'wget' 'rustup' 'wasm-pack')
options=('!strip' '!emptydirs')
source=("typbase-v\$pkgver.tar.gz::https://github.com/lemueldls/typbase/archive/refs/tags/typbase-v\$pkgver.tar.gz")
sha256sums=('$sha256sum')
_builddir="\$pkgname-typbase-v\$pkgver/platform"

prepare() {
    cd "\$srcdir/\$_builddir" || exit 1
    export RUSTUP_TOOLCHAIN=stable
    rustup toolchain install \$RUSTUP_TOOLCHAIN --profile minimal --no-self-update
    rustup target add wasm32-unknown-unknown
    cargo fetch --locked --target "\$(rustc -vV | sed -n 's/host: //p')"
    pnpm install --frozen-lockfile
}

build() {
    cd "\$srcdir/\$_builddir" || exit 1
    export RUSTUP_TOOLCHAIN=stable
    # LTO flags from makepkg.conf break linking for some native deps; clear them.
    export CFLAGS="\${CFLAGS//-flto=auto//}"
    export NUXT_PUBLIC_APP_URL="https://typbase.at"
    cd tauri || exit 1
    pnpm tauri build -b deb -c tauri.package.conf.json
}

package() {
    cd "\$srcdir/\$_builddir" || exit 1
    install -Dm755 target/release/typbase "\$pkgdir"/usr/bin/typbase

    cd "target/release/bundle/deb/Typbase_\${pkgver}_amd64/data" || exit 1
    install -Dm644 usr/share/applications/Typbase.desktop "\$pkgdir"/usr/share/applications/Typbase.desktop
    install -Dm644 usr/share/icons/hicolor/32x32/apps/typbase.png "\$pkgdir"/usr/share/icons/hicolor/32x32/apps/typbase.png
    install -Dm644 usr/share/icons/hicolor/128x128/apps/typbase.png "\$pkgdir"/usr/share/icons/hicolor/128x128/apps/typbase.png
    install -Dm644 usr/share/icons/hicolor/256x256@2/apps/typbase.png "\$pkgdir"/usr/share/icons/hicolor/256x256@2/apps/typbase.png
    install -Dm644 usr/share/licenses/typbase/LICENSE "\$pkgdir"/usr/share/licenses/typbase/LICENSE
}
EOF
