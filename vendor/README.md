# Vendored packages

## nuxtjs-i18n-10.6.0.tgz

`@nuxtjs/i18n` built from `onmax/i18n#agent/nuxt5-nitro3-runtime`, the branch
that adds Nuxt 5 / Nitro 3 support. It is consumed with `file:` in
`apps/web/package.json`.

Why not the git dependency: pnpm builds git dependencies from source, and that
`nuxt-module-build` run fails on Windows ("Failed to prepare package"), which
broke the Windows desktop release. A tarball is prebuilt, so pnpm installs it
as-is on every platform.

To refresh it, from a clone of the branch:

```sh
pnpm install
pnpm pack --pack-destination /tmp
cp /tmp/nuxtjs-i18n-10.6.0.tgz vendor/
```

Then update the version in `apps/web/package.json` and run `pnpm install`.
Delete this directory once upstream `@nuxtjs/i18n` supports the Nuxt version
the app uses.
