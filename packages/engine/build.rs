use std::env;

fn main() {
    let profile = env::var("PROFILE").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let is_wasm = target_arch == "wasm32";

    println!("cargo:rustc-cfg=wasm_target");

    if is_wasm {
        // Enhanced WASM optimizations
        println!("cargo:rustc-env=WASM_BINDGEN_WEAKREF=1");
        println!("cargo:rustc-env=WASM_BINDGEN_EXTERNREF_XFORM=1");
    }

    // WASM-specific link arguments for size optimization. These are wasm-ld
    // flags; passing them to the host linker breaks `cargo bench` and any
    // other host build of the cdylib.
    if is_wasm && profile == "release" {
        println!("cargo:rustc-link-arg=--no-entry");
        println!("cargo:rustc-link-arg=--gc-sections");
        println!("cargo:rustc-link-arg=--strip-all");
        println!("cargo:rustc-link-arg=-zstack-size=2147000000"); // 2 GiB
    }

    // Web-specific features
    if target_env == "unknown" {
        println!("cargo:rustc-cfg=web_target");
    }
}
