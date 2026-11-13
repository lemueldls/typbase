# Themes

A theme is typed data, not code. It changes colors, geometry, and typography
family names. It cannot carry CSS, HTML, fonts, images, or Typst source.

Themes live on the publisher's PDS. The registry is an optional index. The app
can apply a theme from its listing URI without the registry.

## The skin

`@typbase/skin` owns the shape and the validator. A skin has:

- `schema`: `typbase.skin.v1`.
- `palette.light` and `palette.dark`: complete `ThemePaletteTokens` maps.
- `geometry`: `size`, `density`, `radius`.
- `typography`: font families, document text size, ligatures, kerning.

The full palette is explicit, so applying a theme does not depend on the app's
named-theme registry. Soft status backgrounds and `overlay` are part of the
palette and are validated with the rest.

## Records

### `at.typbase.theme`

```json
{
  "name": "Nord",
  "description": "Cool, low-contrast dark theme.",
  "license": "MIT",
  "tags": ["dark"],
  "latest": "at://did:plc:you/at.typbase.themeRelease/1.0.0-a1b2c3d4",
  "createdAt": "2026-11-12T00:00:00.000Z",
  "updatedAt": "2026-11-12T00:00:00.000Z"
}
```

The listing rkey is the slug. `latest` points at the release the app should
apply.

### `at.typbase.themeRelease`

```json
{
  "theme": "at://did:plc:you/at.typbase.theme/nord",
  "version": "1.0.0",
  "schema": "typbase.skin.v1",
  "data": "{ ...canonical skin JSON... }",
  "sha256": "...",
  "size": 4210,
  "createdAt": "2026-11-12T00:00:00.000Z"
}
```

`data` is canonical JSON. `sha256` is over those exact bytes. The release is
immutable. A new publish writes a new release and moves the listing's `latest`.

## Authoring

The app is the visual editor. Export the current skin as a `.tbskin` file, or
publish it from Settings → Appearance → Published themes.

The CLI is for external authors and CI:

```sh
typbase theme init my-theme
typbase theme verify my-theme/theme.json --strict
typbase theme publish my-theme/theme.json --identifier you.bsky.social --release 1.0.0
```

Publishing uses an app password from `--password` or `ATP_PASSWORD`. Use
`--service` or `ATP_SERVICE` for a non-default PDS. The default service is
`https://bsky.social`. Interactive OAuth for the CLI is a later pass; the app
publishes through the browser session.

Settings → Appearance → Reset appearance restores the default skin without
touching uploaded fonts or workspace pages. Unpublishing removes the listing
from the publisher's repo and leaves the local skin applied.

## Applying

- Apply from a listing URI, the registry, or a `.tbskin` file.
- The app copies the skin into workspace settings. The copy works offline.
- Provenance is stored in `themeProvenance`: source URI, version, schema,
  original listing when forked, and a modified flag.
- Editing a palette, geometry, or typography value sets the modified flag.
- Updates are opt-in. The app checks the listing only when the theme browser
  opens.
- Forking keeps `forkedFrom` for attribution. Publishing a fork writes a new
  listing under the current account.

## Registry

`apps/registry` indexes configured publisher DIDs. It reads public records,
validates each skin, verifies the hash, and returns preview colors. It never
hosts records or bytes.

- `GET /api/themes`
- `REGISTRY_PUBLISHERS` is the shared publisher list.

The app reads `NUXT_PUBLIC_REGISTRY_URL`. An empty value keeps the theme
browser local. Direct URI and `.tbskin` import always work.

## Verification

`typbase theme verify` checks the schema, colors, ranges, size, and the hash. It
also prints contrast warnings. `--strict` turns warnings into a failure. A
warning does not block publishing by itself, but the registry and the app show
it on the theme card.

The runtime validators in `@typbase/skin` are the source of truth. The JSON
Schemas under `packages/skin/schema/` are for editors. The app serves copies at
`/schemas/theme.json` and `/schemas/skin.json`.
