#!/usr/bin/env bash
# Validates the release tag against the Tauri config and the tag's changelog,
# creates the draft release if it is missing, and writes the `tag` and
# `version` step outputs.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/lib.sh"

require TAG

tag=$TAG
version=${tag#typbase-v}
[[ "$tag" != "$version" ]] || die "Tag $tag does not start with typbase-v"

repo_root=$(cd "$script_dir/../.." && pwd)
config_version=$(jq -r '.version' "$repo_root/apps/native/tauri.conf.json")
[[ "$version" == "$config_version" ]] ||
    die "Tag version $version does not match tauri.conf.json $config_version"

set_output tag "$tag"
set_output version "$version"

notes_file=$(mktemp)
trap 'rm -f "$notes_file"' EXIT
TAG=$tag VERSION=$version bash "$script_dir/extract-changelog.sh" > "$notes_file"

if ! gh release view "$tag" >/dev/null 2>&1; then
    gh release create "$tag" \
        --draft \
        --title "Typbase v$version" \
        --notes-file "$notes_file"
fi
