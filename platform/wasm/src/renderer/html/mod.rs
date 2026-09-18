use std::{hash::BuildHasher, ops::Range};

use rustc_hash::{FxBuildHasher, FxHashSet};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use typst::{compile, diag::Severity};
use typst_html::{HtmlDocument, HtmlOptions};

use crate::{
    bindings::{TypstDiagnostic, TypstFileId, map_synth_span},
    source::{RenderTarget, SynthResult, sync_source_state},
    state::{TypstRequest, TypstState},
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
                let Some(index) = blocks.iter().position(|block| {
                    let repaired_range = &block.range;

                    let synth_range_start =
                        context.map_repaired_to_render_from_right(repaired_range.start);
                    let synth_range_end =
                        context.map_repaired_to_render_from_right(repaired_range.end);

                    error_ranges.iter().any(|error_range| {
                        (synth_range_start <= error_range.start
                            && synth_range_end >= error_range.start)
                            || (synth_range_start <= error_range.end
                                && synth_range_end >= error_range.end)
                    })
                }) else {
                    break;
                };

                let repaired_range = blocks[index].range.clone();
                let inline = blocks[index].inline;
                blocks.remove(index);

                let mut end_byte = context.map_repaired_to_render_from_right(repaired_range.end);
                if inline {
                    end_byte += 12;
                }

                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics,
                    context,
                    &state.world,
                ));

                crate::error!("[ERRORS]: {diagnostics:?}");

                let start_byte = context.map_repaired_to_render_from_right(repaired_range.start);

                // Earlier passes shrink the synth while the mapper still
                // describes the original text; clamp before blanking.
                let source = context.render_source_mut(&mut state.world).unwrap();
                let len = source.text().len();
                let start_byte = start_byte.min(len);
                let end_byte = end_byte.min(len).max(start_byte);
                source.edit(start_byte..end_byte, &(" ".repeat(end_byte - start_byte)));

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
