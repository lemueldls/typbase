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
create_wrksrc=yes
build_wrksrc="typbase-typbase-v\${version}"
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

do_build() {
	ln -sf /host/.cargo /tmp/.cargo
	ln -sf /host/.rustup /tmp/.rustup
	. /tmp/.cargo/env
	export RUSTUP_TOOLCHAIN=stable
	rustup target add wasm32-unknown-unknown
	export NUXT_PUBLIC_APP_URL="$app_url"
	pnpm install --frozen-lockfile
	cargo fetch --locked --target "\$(rustc -vV | sed -n 's/host: //p')"
	cd apps/native || exit 1
	# tauri.package.conf.json points beforeBuildCommand at
	# \`pnpm -w run generate:direct\`, so the frontend builds without moon and
	# the tarball's missing git metadata is fine.
	pnpm tauri build -b deb -c tauri.package.conf.json
}

do_install() {
	vbin target/release/typbase
	vlicense LICENSE

	cd target/release/bundle/deb/Typbase_\${version}_amd64/data || exit 1
	vmkdir usr/share/applications
	vcopy usr/share/applications/Typbase.desktop usr/share/applications
	vmkdir usr/share/icons/hicolor/32x32/apps
	vcopy usr/share/icons/hicolor/32x32/apps/typbase.png usr/share/icons/hicolor/32x32/apps
	vmkdir usr/share/icons/hicolor/128x128/apps
	vcopy usr/share/icons/hicolor/128x128/apps/typbase.png usr/share/icons/hicolor/128x128/apps
	vmkdir usr/share/icons/hicolor/256x256@2/apps
	vcopy usr/share/icons/hicolor/256x256@2/apps/typbase.png usr/share/icons/hicolor/256x256@2/apps
	vmkdir usr/share/licenses/typbase
	vcopy usr/share/licenses/typbase/LICENSE usr/share/licenses/typbase
}
EOF
