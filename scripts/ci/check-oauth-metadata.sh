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

node - "$root/oauth-client-metadata/native.json" "$origin" <<'NODE'
const fs = require("node:fs");

const [file, origin] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
const scheme = new URL(origin).hostname.split(".").reverse().join(".");
const expected = `${scheme}:/oauth`;
const redirects = metadata.redirect_uris;

if (redirects.length !== 1 || redirects[0] !== expected) {
    console.error(
        `native redirect_uris ${JSON.stringify(redirects)} do not match ${JSON.stringify([expected])} for ${origin}`,
    );
    process.exit(1);
}
NODE

echo "OAuth metadata points at $origin"
