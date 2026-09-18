{
  description = "Build and development environment for Typbase.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        typbase = pkgs.callPackage ./nix/typbase.nix { };
        typbase-bin = pkgs.callPackage ./nix/typbase-bin.nix { };
      in
      {
        packages = {
          inherit typbase typbase-bin;
        };
        defaultPackage = typbase;

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            cargo
            cargo-tauri
            nodejs
            pkg-config
            pnpm
            wasm-pack
          ];

          buildInputs = with pkgs; [
            at-spi2-atk
            atkmm
            cairo
            gdk-pixbuf
            glib
            gtk3
            harfbuzz
            librsvg
            libsoup_3
            openssl
            pango
            webkitgtk_4_1
          ];
        };
      }
    );
}
