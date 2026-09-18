#!/usr/bin/env bash
# Fails unless <tag> contains the version in apps/native/tauri.conf.json.
set -euo pipefail

tag=${1:-}
[[ -n "$tag" ]] || {
    echo "Usage: $0 <tag>" >&2
    exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
version=$(jq -r '.version' "$repo_root/apps/native/tauri.conf.json")

if [[ "$tag" != *"$version"* ]]; then
    echo "Tag $tag does not match the version $version from apps/native/tauri.conf.json" >&2
    exit 1
fi
