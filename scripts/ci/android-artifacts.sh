#!/usr/bin/env bash
# Copies the built APK and AAB into dist/ with release asset names.
set -euo pipefail

version=${1:-}
[[ -n "$version" ]] || {
    echo "Usage: $0 <version>" >&2
    exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
outputs="$repo_root/apps/native/gen/android/app/build/outputs"

mkdir -p "$repo_root/dist"

apk=""
aab=""
if [[ -d "$outputs/apk" ]]; then
    apk=$(find "$outputs/apk" -name '*-release.apk' -print -quit)
fi
if [[ -d "$outputs/bundle" ]]; then
    aab=$(find "$outputs/bundle" -name '*-release.aab' -print -quit)
fi

if [[ -n "$apk" ]]; then
    cp "$apk" "$repo_root/dist/Typbase_${version}_universal.apk"
fi
if [[ -n "$aab" ]]; then
    cp "$aab" "$repo_root/dist/Typbase_${version}_universal.aab"
fi

ls -la "$repo_root/dist"
