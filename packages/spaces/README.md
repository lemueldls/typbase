# @typbase/spaces

The network boundary for Typbase.

- Browser OAuth through airspace.
- The atproto space model for workspaces, pages, plugins, chats, assets, and
  sites.
- The Loro sync engine and relay client.
- Public plugin and theme registries: resolve, list, publish, and verify
  records from a publisher's PDS.

The registry can also be used outside the app to index `at.typbase.plugin` and
`at.typbase.theme` records.

## Published entry

The runtime entry is `dist/index.mjs`. Types are published from `src/*.ts`
because airspace's inferred collection types reference schema classes that
TypeScript 7.0's declaration builder cannot name portably (TS2883). The source
is included in the tarball and is typechecked in CI. Switch the `types` paths to
`dist/*.d.mts` once the declaration builder can emit them.
