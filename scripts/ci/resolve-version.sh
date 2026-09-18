#!/usr/bin/env bash
# Writes the `tag` and `version` step outputs from TAG, a typbase-v<version>
# release tag.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/lib.sh"

require TAG

tag=$TAG
version=${tag#typbase-v}
[[ "$tag" != "$version" ]] || die "Tag $tag does not start with typbase-v"

echo "tag=$tag version=$version"
set_output tag "$tag"
set_output version "$version"
