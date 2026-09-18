#!/usr/bin/env bash

version=$1
sha256sum=$2
app_url=${3:-https://typbase.at}

if [[ -z "$version" || -z "$sha256sum" ]]; then
    echo "Usage: $0 <version> <sha256sum> [app-url]" >&2
    exit 1
fi

cat <<EOF
# Template file for 'typbase'
pkgname=typbase
version=$version
revision=1
archs="x86_64"
build_style=tauri
hostmakedepends="desktop-file-utils"
makedepends="nodejs pnpm libwebkit2gtk41-devel wget file gtk+3-devel librsvg-devel"
depends="libwebkit2gtk41"
short_desc="Local-first knowledge base built around the Typst language"
maintainer="Lemuel De Los Santos <void@lemueldls.dev>"
license="AGPL-3.0-only"
homepage="https://github.com/lemueldls/typbase"
distfiles="https://github.com/lemueldls/typbase/archive/refs/tags/\${pkgname}-v\${version}.tar.gz"
checksum=$sha256sum
wrksrc="typbase-typbase-v\${version}"

do_build() {
	ln -sf /host/.cargo /tmp/.cargo
	ln -sf /host/.rustup /tmp/.rustup
	. /tmp/.cargo/env
	export RUSTUP_TOOLCHAIN=stable
	rustup target add wasm32-unknown-unknown
	cargo fetch --locked --target "\$(rustc -vV | sed -n 's/host: //p')"
	export NUXT_PUBLIC_APP_URL="$app_url"
	cd platform/tauri || exit 1
	pnpm tauri build -b deb -c tauri.package.conf.json
}

do_install() {
	vbin platform/target/release/typbase
	vlicense LICENSE

	cd platform/target/release/bundle/deb/Typbase_\${version}_amd64/data || exit 1
	vcopy usr/share/applications/Typbase.desktop usr/share/applications
	vcopy usr/share/icons/hicolor/32x32/apps/typbase.png usr/share/icons/hicolor/32x32/apps
	vcopy usr/share/icons/hicolor/128x128/apps/typbase.png usr/share/icons/hicolor/128x128/apps
	vcopy usr/share/icons/hicolor/256x256@2/apps/typbase.png usr/share/icons/hicolor/256x256@2/apps
	vcopy usr/share/licenses/typbase/LICENSE usr/share/licenses/typbase
}
EOF
