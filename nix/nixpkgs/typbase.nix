{
  lib,
  stdenv,

  binaryen,
  buildWasmBindgenCli,
  cargo-tauri,
  cmake,
  curl,
  fetchCrate,
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

let
  wasmBindgenSrc = fetchCrate {
    pname = "wasm-bindgen-cli";
    version = "0.2.127";
    hash = "sha256-di+qBAdd7pENLiIB9CoZoab+W5xeDoByMREcCGTSzWo=";
  };

  wasm-bindgen-cli = buildWasmBindgenCli {
    src = wasmBindgenSrc;
    cargoDeps = rustPlatform.fetchCargoVendor {
      inherit (wasmBindgenSrc) pname version;
      src = wasmBindgenSrc;
      hash = "sha256-FTv2GZIAQs0ePdIZXIXil7JbZ6kIT05VG6vqC1qNFxQ=";
    };
  };
in

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
    binaryen
    cargo-tauri.hook
    cmake
    nodejs
    pkg-config
    pnpmConfigHook
    pnpm
    wasm-bindgen-cli
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
    "--config"
    ''{"build":{"beforeBuildCommand":"true"}}''
  ];

  preBuild = ''
    (cd packages/engine && printf '{}' > pkg/package.json \
      && wasm-pack build --release --target web --scope typbase --no-opt .)
    wasm-opt -O4 -all packages/engine/pkg/engine_bg.wasm \
      -o packages/engine/pkg/engine_bg.opt.wasm
    mv packages/engine/pkg/engine_bg.opt.wasm packages/engine/pkg/engine_bg.wasm

    pnpm --filter @typbase/typing build
    pnpm --filter @typbase/storage build
    pnpm --filter @typbase/spaces build
    pnpm --filter @typbase/codemirror build
    pnpm --filter @typbase/web generate
  '';

  env = {
    COREPACK_ENABLE_STRICT = 0;

    OPENSSL_NO_VENDOR = true;

    NUXT_TELEMETRY_DISABLED = 1;
    NUXT_PUBLIC_APP_URL = "https://typbase.at";
  };

  meta = {
    description = "Local-first knowledge base made for Typst and the Atmosphere.";
    homepage = "https://github.com/lemueldls/typbase";
    changelog = "https://github.com/lemueldls/typbase/releases/tag/typbase-v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "typbase";
    platforms = lib.platforms.linux;
  };
})
