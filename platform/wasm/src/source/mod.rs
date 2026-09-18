//! Source management: the raw/pristine-synth/render-source model.
//!
//! Every note in Typbase is backed by three Typst source files and up to four
//! coordinate spaces:
//!
//! - **Raw** (`raw_id`): Exactly what the user typed. Nothing is added or
//!   removed. All editor-facing positions (diagnostics, cursor locations, hover
//!   ranges) are expressed in raw byte offsets.
//!
//! - **Synth** (`synth_id`): A synthesized intermediate file produced by
//!   [`synth::sync_source_context`] on every recompile. It contains:
//!   1. A generated prelude (page geometry, color theme, text defaults)
//!   2. The raw source's content, with block-level wrappers added around each
//!      run of content-producing top-level nodes
//!
//!   The synth is never mutated after it is built. IDE features read it and
//!   its [`IndexMapper`](index::IndexMapper), so error recovery must not
//!   poison it.
//!
//! - **Render** (`render_id`): A disposable copy of the synth the renderer
//!   compiles. It is built from the *repaired* raw text (missing `$` and math
//!   string quotes closed, see [`delimiters`]) and is the only file error
//!   recovery rewrites.
//!
//! The [`IndexMapper`](index::IndexMapper) tracks where synth bytes correspond
//! to raw source bytes, so compiler output can be translated back to
//! coordinates the editor understands.
//!
//! ## Invariant
//!
//! `sync_source_context` rebuilds the pristine synth and render source from
//! scratch on every call. The pristine file does not change until the next
//! sync; the render file changes during a render (delimiter repair, error
//! marks, block blanking) and is rebuilt on the next sync.

mod context;
mod delimiters;
mod index;
mod synth;

pub use context::{SourceContext, SpaceContext};
pub use delimiters::{DelimiterFix, RawFixups, delimiter_diagnostics, find_fixes};
pub use index::{Anchor, AnchorKind, IndexMapper};
pub use synth::{RenderTarget, SynthBlock, SynthResult, sync_source_context, sync_source_state};
