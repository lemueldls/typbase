//! The Typst rendering and IDE engine for typbase, compiled to WebAssembly.
//!
//! ## Architecture
//!
//! The central type is [`state::TypstState`], which owns a
//! [`world::TypstWorld`] and a collection of per-note
//! [`source::context::SourceContext`] values. JavaScript creates a single
//! `TypstState`, registers fonts into it, then
//! calls [`TypstState::compile_paged`] or [`TypstState::compile_html`] on
//! individual notes as the user edits them.
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
//! Unclosed delimiters are repaired before the first compile, so they never
//! de-render the note.

pub mod bindings;
pub mod flatten;
pub mod fonts;
pub mod renderer;
pub mod source;
pub mod state;
pub mod theme;
pub mod world;

#[cfg(test)]
mod tests;

mod utils;

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
