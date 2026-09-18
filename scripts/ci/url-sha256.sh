#!/usr/bin/env bash
# Prints the SHA-256 of the file at <url>.
set -euo pipefail

url=${1:-}
[[ -n "$url" ]] || {
    echo "Usage: $0 <url>" >&2
    exit 1
}

echo "getting $url" >&2
curl -LfsS "$url" | sha256sum | cut -f1 -d ' '
