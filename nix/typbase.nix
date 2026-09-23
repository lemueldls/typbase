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

  appUrl ? "https://typbase.at",
}:

rustPlatform.buildRustPackage (finalAttrs: {
  pname = "typbase";
  version = "0.1.1";

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
    # `fetchPnpmDeps` and `pnpmConfigHook` use a specific version of pnpm, not upstream's.
    COREPACK_ENABLE_STRICT = 0;

    OPENSSL_NO_VENDOR = true;

    NUXT_TELEMETRY_DISABLED = 1;
    NUXT_PUBLIC_APP_URL = appUrl;
  };

  meta = {
    description = "Local-first knowledge base built around the Typst language.";
    homepage = "https://github.com/lemueldls/typbase";
    changelog = "https://github.com/lemueldls/typbase/releases/tag/typbase-v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "typbase";
    platforms = [ "x86_64-linux" ];
  };
})
