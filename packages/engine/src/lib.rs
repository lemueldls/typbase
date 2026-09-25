//! The Typst rendering and IDE engine for Typbase, compiled to WebAssembly.
//!
//! ## Architecture
//!
//! The central type is [`state::TypstState`], which owns a
//! [`world::TypstWorld`] and a collection of per-note
//! [`source::context::SourceContext`] values. JavaScript creates a single
//! `TypstState`, registers fonts into it, then calls
//! [`TypstState::compile_paged`] or [`TypstState::compile_html`] on
//! individual notes as the user edits them.
//!
//! ## Module layout
//!
//! - [`state::TypstState`] owns the world and the contexts, plus the
//!   font/theme/file/package setters the host drives. [`state::RenderContext`]
//!   hands a renderer the world and one note without the rest of the state.
//! - [`renderer::paged`] is the chunked SVG pipeline (editor) and the SVG and
//!   PDF exports; [`renderer::html`] is the inline frames renderer and
//!   [`renderer::html::document`] the full-document HTML render. The
//!   `#[wasm_bindgen]` entry points live next to the code they call.
//! - [`prelude`] holds the app stdlib module and the generated document style.
//! - [`flatten`] and [`links`] are syntax-level passes: flattened block text,
//!   section spans, notebook cells, and the app's link calls.
//! - [`source`] holds the raw/pristine-synth/render-source model.
//! - [`world`] implements Typst's `World` and collects the file and package
//!   requests a compile could not answer.
//!
//! ## The Source Model
//!
//! Each note is backed by three Typst source files internally. See the
//! [`source`] module documentation for a full explanation. In brief:
//!
//! - The `raw` source is exactly what the user typed. All positions returned to
//!   the editor (diagnostics, cursor jumps, hover ranges) are expressed in raw
//!   coordinates.
//!
//! - The `synth` source is a synthesized file built from the raw source plus a
//!   generated prelude. It is never mutated after it is built; the index
//!   mapper tracks raw/synth offsets.
//!
//! - The `render` source is the file Typst actually compiles. It is built from
//!   the repaired raw text (missing `$` and math string quotes closed, see
//!   [`source::delimiters`]) and error recovery rewrites ranges of it in
//!   place. IDE queries parse this file because tracing an expression requires
//!   a compilable main.
//!
//! ## Error Recovery
//!
//! Compile failures are handled by [`renderer::recovery`]. When the render
//! source fails to compile, the recovery pass identifies the offending block,
//! overwrites it with length-preserving whitespace, and retries. Math errors
//! get finer treatment: the broken sub-expression is wrapped in a red-text
//! marker rather than blanked, so the rest of the equation keeps rendering.
//! Markup characters in the marked token are swapped for a same-byte
//! placeholder before wrapping, because the wrapper puts the token back into
//! content mode where `_` and `$` are syntax again. Unclosed delimiters are
//! repaired before the first compile, so they never de-render the note.
//!
//! Errors that carry no span in the note at all, like package code failing
//! after `context` deferral, get bisected instead: recovery compiles prefixes
//! of the blocks and blanks the first one that fails, so a broken package call
//! takes down its own block rather than the whole page. The blamed block's raw
//! range backs the diagnostic, so the editor squiggles the call, not the file.

pub mod bindings;
pub mod flatten;
pub mod fonts;
pub mod links;
pub mod prelude;
pub mod renderer;
pub mod source;
pub mod state;
pub mod theme;
pub mod world;

#[cfg(test)]
mod tests;

mod alloc;
mod utils;

/// Records allocation failures so the app can tell OOM from a normal panic.
/// See [`alloc`].
#[global_allocator]
static ALLOC: alloc::RecordingAlloc = alloc::RecordingAlloc;

use wasm_bindgen::prelude::*;

// #[cfg(debug_assertions)]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn warn(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn debug(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn group(s: &str);
    #[wasm_bindgen(js_namespace = console, js_name = groupEnd)]
    fn group_end(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn time(s: &str);
    #[wasm_bindgen(js_namespace = console, js_name = timeEnd)]
    fn time_end(s: &str);
}

// #[cfg(debug_assertions)]
#[wasm_bindgen(start)]
fn start() {
    utils::set_panic_hook();
}

/// True when the module was built by the dev profile.
///
/// The two wasm tasks write the same `pkg/` directory, so a stray
/// `engine:build-dev` edge in a release graph silently swaps the optimized
/// engine for the unoptimized one. Release tooling can read this before
/// publishing; custom sections cannot key that kind of check because wasm-opt
/// and wasm-bindgen rewrite them.
// wasm-bindgen only accepts non-const functions.
#[allow(clippy::missing_const_for_fn)]
#[wasm_bindgen(js_name = "isDevelopmentBuild")]
#[must_use]
pub fn is_development_build() -> bool {
    cfg!(debug_assertions)
}

/// Drains the allocation-failure flag without going through a `TypstState`
/// handle.
///
/// A trap inside a `&mut self` method leaves wasm-bindgen's borrow flag set
/// (there is no unwinding and no `Drop`), so the method form of this call
/// throws the aliasing error on the dead object exactly when the host needs
/// the reason for the failure. This free function touches a static and a
/// primitive only, so it works on a poisoned instance.
#[wasm_bindgen(js_name = "takeOomGlobal")]
#[must_use]
pub fn take_oom_global() -> bool {
    alloc::take_oom()
}

/// Drains the panic message without going through a `TypstState` handle.
/// See [`take_oom_global`] for why the method form is not usable here.
#[wasm_bindgen(js_name = "takePanicGlobal")]
#[must_use]
pub fn take_panic_global() -> Option<String> {
    utils::take_panic()
}

#[macro_export]
macro_rules! log {
    ($($e:tt)*) => {
        #[cfg(target_arch="wasm32")]
        $crate::log(&format!($($e)*));
        #[cfg(not(target_arch="wasm32"))]
        eprintln!($($e)*);
    };
}

#[macro_export]
macro_rules! debug {
    ($($e:tt)*) => {
        #[cfg(target_arch="wasm32")]
        $crate::debug(&format!($($e)*));
        #[cfg(not(target_arch="wasm32"))]
        eprintln!($($e)*);
    };
}

#[macro_export]
macro_rules! error {
    ($($e:tt)*) => {
        #[cfg(target_arch="wasm32")]
        $crate::error(&format!($($e)*));
        #[cfg(not(target_arch="wasm32"))]
        eprintln!($($e)*);
    };
}

#[macro_export]
macro_rules! group {
    ($($e:tt)*) => {
        #[cfg(target_arch="wasm32")]
        $crate::group(&format!($($e)*));
        #[cfg(not(target_arch="wasm32"))]
        eprintln!($($e)*);
    };
}

#[macro_export]
macro_rules! group_end {
    ($($e:tt)*) => {
        #[cfg(target_arch="wasm32")]
        $crate::group_end(&format!($($e)*));
        #[cfg(not(target_arch="wasm32"))]
        eprintln!($($e)*);
    };
}
