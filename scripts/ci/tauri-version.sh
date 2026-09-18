#!/usr/bin/env bash
# Prints the version from apps/native/tauri.conf.json.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

jq -r '.version' "$repo_root/apps/native/tauri.conf.json"
