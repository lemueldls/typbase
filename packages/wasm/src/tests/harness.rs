//! Shared setup for the in-crate suites: fonts, page ids, compile helpers.

use std::path::{Path, PathBuf};

use crate::{
    bindings::TypstFileId,
    renderer::paged::{PagedRender, items::chunk_by_items},
    source::RenderTarget,
    state::TypstState,
};

/// Font files the render tests install. Names must match what the prelude
/// asks for: `Maple Mono` for text/code, `New Computer Modern Math` for math.
const FONTS: &[&str] = &[
    "maple/MapleMono-Regular.ttf",
    "maple/MapleMono-Bold.ttf",
    "maple/MapleMono-Italic.ttf",
    "math/NewCMMath-Regular.otf",
];

#[must_use]
pub fn fonts_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/fonts")
}

/// True when every font file exists on disk. Render tests bail early without
/// this; they still assert synth/mapper structure.
#[must_use]
pub fn fonts_available() -> bool {
    FONTS.iter().all(|rel| fonts_dir().join(rel).is_file())
}

/// A fresh state with the bundled fonts installed.
#[must_use]
pub fn state() -> TypstState {
    let mut state = TypstState::new();

    for rel in FONTS {
        match std::fs::read(fonts_dir().join(rel)) {
            Ok(bytes) => state.install_font(bytes),
            Err(error) => eprintln!("test font {rel} not loaded: {error}"),
        }
    }

    state
}

/// Creates a page source in the `test` space and returns its id.
pub fn page(state: &mut TypstState, name: &str) -> TypstFileId {
    state.create_source_id(&format!("pages/{name}.typ"), String::from("test"))
}

/// Compiles a page the way the editor does: SVG target through the chunked
/// recovery path. The editor inserts the page text under the synth id before
/// the first compile; the renderer replaces it with the built synth on sync.
pub fn compile(state: &mut TypstState, id: &TypstFileId, text: &str) -> PagedRender {
    state.insert_source(id, text.to_string());

    chunk_by_items(id, text, "", RenderTarget::Svg, state)
}

/// The render source text (the synth the renderer compiles). Tests read it
/// after a sync instead of receiving a copy from the result.
#[must_use]
pub fn render_text(state: &TypstState, id: &TypstFileId) -> String {
    state
        .source_context_map
        .get(id)
        .unwrap()
        .render_source(&state.world)
        .unwrap()
        .text()
        .to_string()
}
