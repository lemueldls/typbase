pub mod document;

use std::{hash::BuildHasher, ops::Range};

use rustc_hash::{FxBuildHasher, FxHashSet};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use typst::{compile, diag::Severity};
use typst_html::{HtmlDocument, HtmlOptions};
use wasm_bindgen::prelude::*;

use crate::{
    bindings::{CompileHTMLResult, TypstDiagnostic, TypstFileId, map_synth_span},
    renderer::recovery::{
        PROBE_BUDGET, blamed_raw_range, remove_unmappable_block, split_unmappable,
    },
    source::{RenderTarget, SegmentKind, Side, SynthResult, sync_source_state},
    state::TypstState,
    world::TypstRequest,
};

pub fn render(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    state: &mut TypstState,
) -> HTMLRenderResult {
    let SynthResult { mut blocks, .. } =
        sync_source_state(id, text, prelude, RenderTarget::Html, state);

    let mut last_document = None;

    let mut diagnostics = Vec::new();
    let mut compiled_warnings = None;

    // let mut erronous_ranges = Vec::new();

    let context = state.source_context_map.get_mut(id).unwrap();

    // Compile the render source so recovery can blank blocks without
    // touching the pristine synth.
    state.world.main_id = Some(context.render_id);

    let mut frames = Vec::new();

    // Probe compiles the unmappable-error bisection may spend on this render.
    let mut probe_budget = PROBE_BUDGET;

    while last_document.is_none() {
        let compiled = compile::<HtmlDocument>(&state.world);
        compiled_warnings = Some(compiled.warnings);

        // crate::log!("[DOING A THING]");

        frames = match compiled.output {
            Ok(document) => {
                let element = typst_html::html(&document, &HtmlOptions::default())
                    .expect("HTML rendering failed");

                last_document = Some(document);

                vec![HTMLRangedFrame {
                    range: 0..text.len(),
                    render: HTMLFrameRender {
                        html: element.clone(),
                        #[allow(clippy::cast_possible_truncation)]
                        hash: FxBuildHasher.hash_one(&element) as u32,
                    },
                }]
            }
            Err(source_diagnostics) => {
                let (mapped, unmappable) =
                    split_unmappable(&source_diagnostics, context, &state.world);

                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    mapped,
                    context,
                    &state.world,
                ));

                let error_ranges = source_diagnostics
                    .iter()
                    .filter_map(|diagnostic| {
                        map_synth_span(
                            diagnostic.span,
                            diagnostic.severity == Severity::Error,
                            &diagnostic.trace,
                            context,
                            &state.world,
                        )
                    })
                    .collect::<FxHashSet<_>>();

                // crate::log!("[ERROR RANGES]: {error_ranges:?}");

                // Pick the offending block by index and drop it from the
                // candidate list: blanking it does not change the mapper, so
                // keeping it around would loop forever on unfixable errors.
                let index = blocks.iter().position(|block| {
                    let repaired_range = &block.range;

                    // Outer range: include the generated wrapper so error
                    // spans that land on it still select the block.
                    let synth_range_start =
                        context.map_repaired_to_render(repaired_range.start, Side::Before);
                    let synth_range_end =
                        context.map_repaired_to_render(repaired_range.end, Side::After);

                    error_ranges.iter().any(|error_range| {
                        (synth_range_start <= error_range.start
                            && synth_range_end >= error_range.start)
                            || (synth_range_start <= error_range.end
                                && synth_range_end >= error_range.end)
                    })
                });

                if let Some(index) = index {
                    let repaired_range = blocks[index].range.clone();
                    let inline = blocks[index].inline;
                    blocks.remove(index);

                    let mut end_byte =
                        context.map_repaired_to_render(repaired_range.end, Side::After);
                    if inline {
                        end_byte += 12;
                    }

                    crate::error!("[ERRORS]: {diagnostics:?}");

                    let start_byte =
                        context.map_repaired_to_render(repaired_range.start, Side::Before);

                    // Earlier passes shrink the synth while the map still
                    // describes the original text; clamp before blanking.
                    let source = context.render_source_mut(&mut state.world).unwrap();
                    let len = source.text().len();
                    let start_byte = start_byte.min(len);
                    let end_byte = end_byte.min(len).max(start_byte);
                    let whitespace = " ".repeat(end_byte - start_byte);
                    source.edit(start_byte..end_byte, &whitespace);
                    context.render_map.replace(
                        start_byte..end_byte,
                        &whitespace,
                        SegmentKind::ErrorMark,
                    );
                } else if let Some((index, blamed)) = remove_unmappable_block::<HtmlDocument>(
                    &blocks,
                    &source_diagnostics,
                    context,
                    &mut state.world,
                    &mut probe_budget,
                ) {
                    // Report the blamed prefix's errors on the block that
                    // caused them, not the whole note.
                    let raw = blamed_raw_range(&blocks[index], context, &state.world);
                    let (_, blamed_unmappable) =
                        split_unmappable(&blamed, context, &state.world);

                    diagnostics.extend(TypstDiagnostic::from_diagnostics_with_fallback(
                        blamed_unmappable.into_iter().collect(),
                        context,
                        &state.world,
                        Some(&raw),
                    ));

                    // The search blanked the block; drop it from the
                    // candidate list so it cannot be selected again.
                    blocks.remove(index);
                } else {
                    crate::error!("NO ERROR BLOCKS FOUND ‼️");

                    diagnostics.extend(TypstDiagnostic::from_diagnostics_with_fallback(
                        unmappable.into_iter().collect(),
                        context,
                        &state.world,
                        None,
                    ));

                    break;
                }

                Vec::new()
            }
        };
    }

    state.world.main_id = Some(context.synth_id);

    crate::debug!("FRAMES: {frames:?}");

    if let Some(warnings) = compiled_warnings {
        diagnostics.extend(TypstDiagnostic::from_diagnostics(
            warnings,
            context,
            &state.world,
        ));
    }

    HTMLRenderResult {
        frames,
        diagnostics,
    }
}

#[derive(Tsify, Serialize, Deserialize)]
pub struct HTMLRenderResult {
    pub frames: Vec<HTMLRangedFrame>,
    pub diagnostics: Vec<TypstDiagnostic>,
}

#[derive(Debug, Clone, Tsify, Serialize, Deserialize)]
pub struct HTMLRangedFrame {
    pub range: Range<usize>,
    pub render: HTMLFrameRender,
}

#[derive(Debug, Clone, Tsify, Serialize, Deserialize)]
pub struct HTMLFrameRender {
    html: String,
    hash: u32,
}

/// Result of rendering a Typst document to HTML.
#[derive(Tsify, Serialize, Deserialize)]
pub struct RenderHtmlResult {
    /// The rendered HTML document, if successful.
    pub document: Option<String>,
    /// Diagnostics and warnings produced during rendering.
    pub diagnostics: Vec<TypstDiagnostic>,
    /// Requests the caller must satisfy before re-rendering (query JSON,
    /// embedded pages). The editor's `compileHTML` carries them too; the
    /// publish worker needs them on this path.
    pub requests: Vec<TypstRequest>,
}

#[wasm_bindgen]
impl TypstState {
    /// The editor's inline HTML render: one ranged frame for the whole note,
    /// with the frames renderer's block-blanking recovery. Publishing, export,
    /// and chat use `renderHtml` (see [`document`]) instead.
    #[wasm_bindgen(js_name = "compileHTML")]
    pub fn compile_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CompileHTMLResult>, JsError> {
        let result = render(id, text, prelude, self);

        Ok(CompileHTMLResult {
            frames: result.frames,
            diagnostics: result.diagnostics,
            requests: self.world.take_requests(),
        }
        .into_ts()?)
    }
}
