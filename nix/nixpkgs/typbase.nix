{
  lib,
  stdenv,

  cargo-tauri,
  cmake,
  curl,
  fetchFromGitHub,
  glib-networking,
  nodejs,
  openssl,
  pkg-config,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm,
  rustPlatform,
  wasm-pack,
  webkitgtk_4_1,
  wrapGAppsHook4,
}:

# Nixpkgs-ready derivation. The release workflow copies this file into a
# nixpkgs fork at pkgs/by-name/ty/typbase/package.nix, fills the hashes with
# nix-update, and opens a PR.
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "typbase";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "lemueldls";
    repo = "typbase";
    tag = "typbase-v${finalAttrs.version}";
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  cargoHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  buildAndTestSubdir = "apps/native";

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 3;
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  nativeBuildInputs = [
    cargo-tauri.hook
    cmake
    nodejs
    pkg-config
    pnpmConfigHook
    pnpm
    wasm-pack
    wrapGAppsHook4
  ];

  buildInputs = [
    openssl
  ]
  ++ lib.optional stdenv.hostPlatform.isDarwin curl
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    glib-networking
    webkitgtk_4_1
  ];

  tauriBuildFlags = [
    "--config"
    "tauri.package.conf.json"
  ];

  env = {
    COREPACK_ENABLE_STRICT = 0;

    OPENSSL_NO_VENDOR = true;

    NUXT_TELEMETRY_DISABLED = 1;
    NUXT_PUBLIC_APP_URL = "https://typbase.at";
  };

  meta = {
    description = "Local-first knowledge base built around the Typst language.";
    homepage = "https://github.com/lemueldls/typbase";
    changelog = "https://github.com/lemueldls/typbase/releases/tag/typbase-v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "typbase";
    platforms = lib.platforms.linux;
  };
})
