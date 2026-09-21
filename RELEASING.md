# Releasing

Releases are tag-driven. A tag `typbase-v<version>` starts the whole pipeline:

1. **Prepare** creates the GitHub release as a draft (or reuses it).
2. **Desktop** builds Linux, macOS (universal), and Windows bundles with
   [tauri-action](https://github.com/tauri-apps/tauri-action), signs the updater
   artifacts, and uploads them to the draft.
3. **Android** builds a signed universal APK and AAB.
4. **Publish release** un-drafts the release, which makes the asset URLs public.
5. **npm**, **AUR**, **Void**, and **Nix** run after that. AUR, Void, and the
   nixpkgs PR download release assets, so they need the published release.

The release workflow calls those jobs directly instead of relying on the
`release: published` event, because events created with `GITHUB_TOKEN` do not
start other workflows. The packaging workflows also listen for
`release: published` and accept a `workflow_dispatch` tag, so a manually
published release still works.

## Cutting a release

1. Run the **Bump Version** workflow with `dry-run` checked to see the next
   version, then again with `dry-run` unchecked. It updates every version
   source (Cargo workspace and lockfile, Tauri config, Android version code,
   `packages/*`, nix derivations), regenerates `CHANGELOG.md`, commits, tags
   `typbase-v<version>`, and pushes. The tag starts the release.
2. Watch the **Release** workflow. If a build fails, fix it and re-run the
   failed jobs; the draft release keeps the assets that already uploaded.
3. Reword the draft release notes on GitHub if the generated text reads badly.
   The release stays a draft until every build finishes, so that is the window
   for editing the public copy without touching `CHANGELOG.md`.
4. Re-running a single packaging workflow is possible from the Actions tab with
   the tag as input.

## Changelog

`CHANGELOG.md` is generated from conventional commit subjects with
[git-cliff](https://git-cliff.org), one section per release, and it is not
edited by hand. The **Bump Version** workflow runs `scripts/ci/bump-version.sh`,
which regenerates the whole file from the tags before it commits, so the tag
points at a commit that already contains its entry. A missing file is written
in full, which covers the first release.

- Groups are **Breaking changes**, **New**, **Fixed**, and **Improved**.
  `chore`, `ci`, `docs`, `test`, `build`, `style`, and `refactor` commits are
  skipped, and scopes are not rendered. The rules live in `.cliff.toml`.
- `pnpm changelog` previews the next section from the commits since the last
  tag.
- Commit subjects are release copy. `fix: crash when opening a notebook` lands
  in the notes as written; `fix: null deref in cell splitter` does not.
- The GitHub release body is that same section, read back from the tag's
  `CHANGELOG.md` by `scripts/ci/extract-changelog.sh`. A tag without a section
  for its version fails the **Prepare** job before any build starts.

## Secrets and variables

Repository secrets:

| Secret                                          | Used by           | Notes                                                                                                                                            |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`                     | Desktop           | Updater signing key. Generate with `pnpm tauri signer generate`; put the public key in `apps/native/tauri.conf.json` (`plugins.updater.pubkey`). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | Desktop           | Password for the key above.                                                                                                                      |
| `ANDROID_KEYSTORE`                              | Android           | Base64 of the `.jks` keystore. Without it the APK is unsigned.                                                                                   |
| `ANDROID_KEYSTORE_PROPERTIES`                   | Android           | Base64 of a `keystore.properties` with `keyAlias`, `keyPassword`, `storeFile=key.jks`, `storePassword`.                                          |
| `AUR_DEPLOY_KEY`                                | AUR               | SSH private key registered on your AUR account.                                                                                                  |
| `XBPS_REPOSITORY_SIGNING_KEY`                   | Void              | RSA private key for `xbps-rindex` signing.                                                                                                       |
| `SSH_SIGNING_KEY`                               | Bump Version, Nix | SSH key for signed commits and tags.                                                                                                             |
| `NPM_TOKEN`                                     | npm               | npm automation token with publish rights.                                                                                                        |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploy            | Cloudflare Workers. The deploy job skips when unset.                                                                                             |
| `NIXPKGS_TOKEN`                                 | Nix               | Token with `repo` and `workflow` scope on your nixpkgs fork. The PR job skips when unset.                                                        |

Repository variables:

| Variable              | Default              | Notes                                                                             |
| --------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_APP_URL` | `https://typbase.at` | Origin baked into release builds. The atproto OAuth client id is derived from it. |
| `NIXPKGS_FORK`        | unset                | `owner/nixpkgs` fork used for the automated PR. The job skips when unset.         |

## One-time setup

- **AUR**: create the `typbase` and `typbase-bin` package bases on
  aur.archlinux.org and add `AUR_DEPLOY_KEY`'s public half to your account.
  The workflow pushes to `ssh://aur@aur.archlinux.org/<name>.git`.
- **Android**: create a keystore, then base64 both files:
  ```sh
  base64 -w0 release.jks > keystore.b64
  base64 -w0 keystore.properties > keystore.properties.b64
  ```
  `keystore.properties` must point `storeFile` at `key.jks`; the workflow
  writes it next to `apps/native/gen/android/app/build.gradle.kts`.
- **nixpkgs**: fork NixOS/nixpkgs, set `NIXPKGS_FORK` to `owner/nixpkgs`, and
  add a `NIXPKGS_TOKEN`. The first submission still needs a maintainer entry
  in nixpkgs (`maintainers/maintainer-list.nix`) and reviewer approval; later
  releases update the package automatically. The workflow copies
  `nix/nixpkgs/typbase.nix` to `pkgs/by-name/ty/typbase/package.nix` and runs
  `nix-update` for the hashes.
- **Nix flake**: the first `nix build .#typbase` needs real hashes. Run
  `nix-update --flake --version <version> --build typbase` locally, or let the
  Nix workflow do it on the first release.

## Local checks

```sh
moon run native:build                                     # desktop bundle
moon run native:android-build                             # Android APK/AAB
scripts/distro/aur/generate-typbase.sh 0.1.0 <sha256>     # source PKGBUILD
scripts/distro/aur/generate-typbase-bin.sh 0.1.0 <sha256> # binary PKGBUILD
scripts/distro/void/generate-template.sh 0.1.0 <sha256>   # xbps template
nix build .#typbase .#typbase-bin                         # flake packages
```
