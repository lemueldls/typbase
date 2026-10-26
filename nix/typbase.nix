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
  lld,
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

let
  # wasm-pack runs the CLI that matches the wasm-bindgen crate in Cargo.lock, so
  # this pin has to move with it. Bump the version and both hashes together.
  wasmBindgenSrc = fetchCrate {
    pname = "wasm-bindgen-cli";
    version = "0.2.129";
    hash = "sha256-pcecKQd7E8Opw6bkFoE569epUi7gh5qpQF1e5PJY6V8=";
  };

  wasm-bindgen-cli = buildWasmBindgenCli {
    src = wasmBindgenSrc;
    cargoDeps = rustPlatform.fetchCargoVendor {
      inherit (wasmBindgenSrc) pname version;
      src = wasmBindgenSrc;
      hash = "sha256-vmUrWVU7kPJJxO5qIVeAkwQyWDELO1Z4Z5gitz2kco8=";
    };
  };
in

rustPlatform.buildRustPackage (finalAttrs: {
  pname = "typbase";
  version = "0.4.6";

  src = fetchFromGitHub {
    owner = "lemueldls";
    repo = "typbase";
    tag = "typbase-v${finalAttrs.version}";
    hash = "sha256-dHMCDTIkKeUmoJ6LXMRbIK304MwP8I9FHL9wtl0qLBs=";
  };

  cargoHash = "sha256-WpNX71q1RQJm2mCvdKjnFO+WBciX6PwfqErs65vpc58=";

  buildAndTestSubdir = "apps/native";

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 3;
    hash = "sha256-Pxv0bN4XED4EYUqQHXlQYP6SeYg4MsP9NScBbk+hc8Q=";
  };

  nativeBuildInputs = [
    binaryen
    cargo-tauri.hook
    cmake
    lld
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
      && wasm-pack build --mode no-install --release --target web --scope typbase --no-opt .)
    wasm-opt -O4 -all packages/engine/pkg/engine_bg.wasm \
      -o packages/engine/pkg/engine_bg.opt.wasm
    mv packages/engine/pkg/engine_bg.opt.wasm packages/engine/pkg/engine_bg.wasm

    pnpm --filter @typbase/web generate
  '';

  env = {
    # `fetchPnpmDeps` and `pnpmConfigHook` use a specific version of pnpm, not upstream's.
    COREPACK_ENABLE_STRICT = 0;

    OPENSSL_NO_VENDOR = true;

    NUXT_TELEMETRY_DISABLED = 1;
    NUXT_PUBLIC_APP_URL = appUrl;
  };

  meta = {
    description = "Local-first knowledge base made for Typst and the Atmosphere.";
    homepage = "https://github.com/lemueldls/typbase";
    changelog = "https://github.com/lemueldls/typbase/releases/tag/typbase-v${finalAttrs.version}";
    license = lib.licenses.asl20;
    mainProgram = "typbase";
    platforms = [ "x86_64-linux" ];
  };
})
