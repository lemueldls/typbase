# Typbase registry

A small, self-hostable catalog for plugins and themes published as AT Protocol
records. The registry does not host accounts, records, or release bytes.
Publishers write `at.typbase.plugin`, `at.typbase.pluginRelease`,
`at.typbase.theme`, and `at.typbase.themeRelease` records to their own PDS.
This service only resolves and displays what it is configured to index.

## Run

Set the publishers whose listings should appear:

```sh
REGISTRY_PUBLISHERS=did:plc:...,did:web:... pnpm dev:registry
```

Then open `http://localhost:3002`. The catalog is at `/api/plugins` and
`/api/themes`.

## Deploy

`pnpm build:registry` produces a Nitro server. Deploy it anywhere Nitro runs.
The registry needs outbound access to the publishers' PDS hosts.

## Trust

The registry verifies that a release points back at its listing. For plugins it
reports the release artifact checksum. The Typbase app downloads the artifact
from the publisher's PDS and verifies its size and SHA-256 again before
installing. For themes it validates the skin with `@typbase/skin`, checks the
canonical hash, and generates preview colors. The registry is discovery, not an
authority.

## Deploy

The `Deploy Registry` workflow builds the Cloudflare module worker and deploys
it. Configure these repository variables:

- `REGISTRY_PUBLISHERS`: comma-separated DIDs to index.
- `REGISTRY_WORKER_NAME`: Worker name, defaults to `typbase-registry`.
- `REGISTRY_URL`: public origin used for the post-deploy `/health` check.

The Worker URL is normally
`https://<worker-name>.<account-subdomain>.workers.dev`. Set `REGISTRY_URL` to
the exact deployed origin, including a custom domain if one is attached.

The `checks` CI job also builds the Node server and calls `/health` and
`/api/plugins` before the registry is deployed. `/api/themes` is available for
the app theme browser.
