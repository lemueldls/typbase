#!/usr/bin/env bash
# Copies the per-ABI APKs and the universal AAB into dist/ with release asset
# names, and writes android.json (the sideload update manifest) for releases.
set -euo pipefail

version=${1:-}
tag=${2:-}
repo=${GITHUB_REPOSITORY:-lemueldls/typbase}
[[ -n "$version" ]] || {
    echo "Usage: $0 <version> [tag]" >&2
    exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
outputs="$repo_root/apps/native/gen/android/app/build/outputs"
dist="$repo_root/dist"

mkdir -p "$dist"
shopt -s nullglob

# Gradle flavor name -> Android ABI, matching RustPlugin.kt's arch list.
declare -A abi_for_arch=(
    [arm64]="arm64-v8a"
    [arm]="armeabi-v7a"
    [x86]="x86"
    [x86_64]="x86_64"
)

asset_url() {
    printf 'https://github.com/%s/releases/download/%s/%s' "$repo" "$tag" "$1"
}

abis="{}"
for apk in "$outputs"/apk/*/release/app-*-release.apk; do
    flavor=$(basename "$(dirname "$(dirname "$apk")")")
    abi=${abi_for_arch[$flavor]:-}
    if [[ -z "$abi" ]]; then
        echo "warning: unknown APK flavor '$flavor', skipping $apk" >&2
        continue
    fi

    name="Typbase_${version}_${abi}.apk"
    cp "$apk" "$dist/$name"
    sha=$(sha256sum "$dist/$name" | cut -d' ' -f1)
    size=$(stat -c%s "$dist/$name")
    abis=$(jq -c \
        --arg key "$abi" \
        --arg url "$(asset_url "$name")" \
        --arg sha "$sha" \
        --argjson size "$size" \
        '. + {($key): {url: $url, sha256: $sha, size: $size}}' <<<"$abis")
done

aab=""
if [[ -d "$outputs/bundle" ]]; then
    aab=$(find "$outputs/bundle" -name '*-release.aab' -print -quit)
fi
if [[ -n "$aab" ]]; then
    cp "$aab" "$dist/Typbase_${version}_universal.aab"
fi

# Test builds have no release to point at, so only releases get a manifest.
if [[ -n "$tag" ]]; then
    jq -n \
        --arg version "$version" \
        --arg publishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --argjson abis "$abis" \
        '{version: $version, publishedAt: $publishedAt, abis: $abis}' > "$dist/android.json"
fi

ls -la "$dist"
