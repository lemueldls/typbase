#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
VERSION=${IOSEVKA_VERSION:-34.9.1}
JOBS=${JOBS:-2}
CACHE="$ROOT/.cache/iosevka/$VERSION"
SRC="$CACHE/src"
MONO_OUT="$ROOT/apps/web/public/fonts/code"
TEXT_OUT="$ROOT/apps/web/public/fonts/text"

for command in curl tar npm node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "missing build dependency: $command" >&2
    exit 1
  fi
done

mkdir -p "$CACHE"

if [ ! -d "$SRC" ]; then
  echo "downloading Iosevka $VERSION"
  curl -fsSL \
    "https://github.com/be5invis/Iosevka/archive/refs/tags/v$VERSION.tar.gz" \
    -o "$CACHE/iosevka.tar.gz"
  mkdir -p "$SRC"
  tar -xzf "$CACHE/iosevka.tar.gz" -C "$SRC" --strip-components=1
fi

if [ ! -d "$SRC/node_modules" ]; then
  echo "installing Iosevka build dependencies"
  if [ -f "$SRC/package-lock.json" ]; then
    (cd "$SRC" && npm ci)
  else
    (cd "$SRC" && npm install)
  fi
fi

cp "$SCRIPT_DIR/private-build-plans.toml" "$SRC/private-build-plans.toml"

echo "building Iosevka $VERSION"
rm -rf "$SRC/.build" "$SRC/dist/IosevkaConcreteCode"
(cd "$SRC" && npm run build -- ttf-unhinted::IosevkaConcreteCode --jCmd="$JOBS")

rm -rf "$SRC/.build" "$SRC/dist/IosevkaConcreteText"
(cd "$SRC" && npm run build -- ttf-unhinted::IosevkaConcreteText --jCmd="$JOBS")

MONO_BUILT="$SRC/dist/IosevkaConcreteCode/TTF-Unhinted"
TEXT_BUILT="$SRC/dist/IosevkaConcreteText/TTF-Unhinted"

mkdir -p "$MONO_OUT" "$TEXT_OUT"
cp "$MONO_BUILT"/*.ttf "$MONO_OUT"/
cp "$TEXT_BUILT"/*.ttf "$TEXT_OUT"/

echo "wrote $MONO_OUT"
du -sh "$MONO_OUT"
echo "wrote $TEXT_OUT"
du -sh "$TEXT_OUT"
