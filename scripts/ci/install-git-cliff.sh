#!/usr/bin/env bash
# Installs git-cliff for CI jobs that do not run pnpm install. The version
# comes from the devDependency in the root package.json so local and CI runs
# use the same binary.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)

version=$(node -p "require('$repo_root/package.json').devDependencies['git-cliff'].replace(/^[^0-9]+/, '')")
npm install --global --no-fund --no-audit "git-cliff@$version"
