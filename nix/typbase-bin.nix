{
  lib,
  stdenv,

  fetchurl,
  autoPatchelfHook,
  dpkg,
  openssl,
  webkitgtk_4_1,
  libappindicator,
  wrapGAppsHook4,
  shared-mime-info,
  glib-networking,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "typbase";
  version = "0.1.1";

  src = fetchurl {
    url = "https://github.com/lemueldls/typbase/releases/download/typbase-v${finalAttrs.version}/Typbase_${finalAttrs.version}_amd64.deb";
    sha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  dontConfigure = true;
  dontBuild = true;

  nativeBuildInputs = [
    dpkg
    autoPatchelfHook
    wrapGAppsHook4
  ];

  buildInputs = [
    openssl
    webkitgtk_4_1
    libappindicator
    shared-mime-info
    glib-networking
  ];

  installPhase = ''
    runHook preInstall

    install -Dm755 usr/bin/typbase $out/bin/${finalAttrs.meta.mainProgram}
    cp -r usr/share $out

    wrapProgram "$out/bin/${finalAttrs.meta.mainProgram}" \
      --prefix GIO_EXTRA_MODULES : "${glib-networking}/lib/gio/modules"

    runHook postInstall
  '';

  meta = {
    description = "Local-first knowledge base built around the Typst language.";
    homepage = "https://github.com/lemueldls/typbase";
    changelog = "https://github.com/lemueldls/typbase/releases/tag/typbase-v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "typbase";
    platforms = [ "x86_64-linux" ];
  };
})
