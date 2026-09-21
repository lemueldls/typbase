#!/usr/bin/env bash
# Fails when the prerendered OAuth client metadata does not match the deploy
# origin. Static builds bake NUXT_PUBLIC_APP_URL into these documents, and the
# default is localhost, which produces a loopback client id that the PDS will
# not accept for a deployed client.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/lib.sh"

require APP_URL

origin=${APP_URL%/}
root=${1:-apps/web/.output/public}

for file in "$root/oauth-client-metadata.json" "$root/oauth-client-metadata/native.json"; do
    [[ -f "$file" ]] || die "$file is missing; run pnpm build before this check"
done

grep -qF "\"client_id\":\"$origin/oauth-client-metadata.json\"" \
    "$root/oauth-client-metadata.json" ||
    die "web client_id does not point at $origin"
grep -qF "\"redirect_uris\":[\"$origin/\"]" \
    "$root/oauth-client-metadata.json" ||
    die "web redirect_uris do not point at $origin"
grep -qF "\"client_id\":\"$origin/oauth-client-metadata/native.json\"" \
    "$root/oauth-client-metadata/native.json" ||
    die "native client_id does not point at $origin"

echo "OAuth metadata points at $origin"
