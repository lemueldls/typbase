#!/usr/bin/env bash
# Writes the Android signing files from the base64 secrets. Leaves the release
# build unsigned when the secrets are missing.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
android_dir="$repo_root/apps/native/gen/android"

if [[ -z "${ANDROID_KEYSTORE:-}" || -z "${ANDROID_KEYSTORE_PROPERTIES:-}" ]]; then
    echo "No Android signing secrets set; the release APK stays unsigned."
    exit 0
fi

echo "$ANDROID_KEYSTORE" | base64 --decode > "$android_dir/app/key.jks"
echo "$ANDROID_KEYSTORE_PROPERTIES" | base64 --decode > "$android_dir/keystore.properties"
