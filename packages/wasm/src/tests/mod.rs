//! Host-target test suites for the engine.
//!
//! These run with plain `cargo test` on the host target. Rendering tests need
//! the bundled fonts from `apps/web/public/fonts/`; when those files are missing (CI
//! images without a checkout of the repo root) the render assertions skip with
//! a printed note instead of failing.
//!
//! Sources live as `.typ` files under `src/tests/fixtures/`; `fixtures.rs`
//! walks them and documents the contract of each directory.
//!
//! See `/home/lemuel/.opencode/plan/typbase-wasm-correctness.md` for the
//! correctness pass these suites pin down.

mod fixtures;
mod harness;

mod characterize;
mod ide;
mod mapper;
mod partition;
mod recovery;
mod synth;
mod tooltip;
