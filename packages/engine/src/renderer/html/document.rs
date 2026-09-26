//! The full-document HTML render used by publishing, exports, and chat.
//!
//! Unlike the ranged-frames renderer in the parent module, this compiles the
//! render source once and runs `remove_errornous_block` until the document
//! compiles or the convergence cap is hit. The pristine synth stays untouched,
//! so the editor's diagnostics are unaffected.
//!
//! The compile and recovery loops take a [`RenderContext`], so they only see
//! the world and this note's source context. The wasm entry points compose the
//! prelude and sync the sources, then hand the context over.

use tsify::{Ts, Tsify};
use typst::compile;
use typst_html::{HtmlDocument, HtmlOptions};
use wasm_bindgen::prelude::*;

use crate::{
    bindings::{CheckResult, TypstDiagnostic, TypstFileId},
    renderer::{
        html::RenderHtmlResult,
        recovery::{
            PROBE_BUDGET, blamed_raw_range, remove_errornous_block, remove_unmappable_block,
            split_unmappable,
        },
    },
    source::{RenderTarget, SynthBlock, SynthResult, sync_source_state},
    state::{RenderContext, TypstState},
};

#[wasm_bindgen]
impl TypstState {
    /// Renders the whole note to one HTML document, with recovery. Used by
    /// publish, export, and chat; the editor's inline frames use
    /// `compileHTML` instead.
    #[wasm_bindgen(js_name = renderHtml)]
    pub fn render_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<RenderHtmlResult>, JsError> {
        let SynthResult { blocks, .. } =
            sync_source_state(id, text, prelude, RenderTarget::Html, self);

        let mut ctx = self.render_context(id).unwrap();
        let (document, diagnostics) = render_html_ctx(&mut ctx, &blocks);

        Ok(RenderHtmlResult {
            document,
            diagnostics,
            requests: ctx.world.take_requests(),
        }
        .into_ts()?)
    }

    /// Diagnostics-only HTML pass: compile the pristine synth, no recovery.
    #[wasm_bindgen(js_name = "checkHTML")]
    pub fn check_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CheckResult>, JsError> {
        sync_source_state(id, text, prelude, RenderTarget::Html, self);

        let mut ctx = self.render_context(id).unwrap();
        let diagnostics = check_html_ctx(&mut ctx);

        Ok(CheckResult {
            diagnostics,
            requests: ctx.world.take_requests(),
        }
        .into_ts()?)
    }
}

/// Compiles the render source to an HTML document, blanking offending blocks
/// until it compiles or the divergence cap is hit.
pub(crate) fn render_html_ctx(
    ctx: &mut RenderContext<'_>,
    blocks: &[SynthBlock],
) -> (Option<String>, Vec<TypstDiagnostic>) {
    let mut diagnostics = Vec::new();
    let mut compiled_warnings = None;

    // Recovery blanks blocks of the render source; the pristine synth stays
    // available to the editor.
    ctx.world.main_id = Some(ctx.note.render_id);

    let mut document = None;
    let mut convergence = 0_u8;

    // Probe compiles the unmappable-error bisection may spend on this render.
    let mut probe_budget = PROBE_BUDGET;

    while document.is_none() {
        let compiled = compile::<HtmlDocument>(ctx.world);
        compiled_warnings = Some(compiled.warnings);

        document = match compiled.output {
            Ok(document) => {
                let html = typst_html::html(&document, &HtmlOptions::default());

                match html {
                    Ok(html) => Some(html),
                    Err(source_diagnostics) => {
                        crate::error!("[HTML ERRORS]: {source_diagnostics:?}");

                        diagnostics.extend(TypstDiagnostic::from_diagnostics(
                            source_diagnostics,
                            ctx.note,
                            ctx.world,
                        ));

                        // The document compiled; the export pass is what
                        // failed. Blanking blocks cannot help, so stop
                        // instead of recompiling the same document forever.
                        break;
                    }
                }
            }
            Err(source_diagnostics) => {
                convergence += 1;
                if convergence >= 128 {
                    crate::error!("COULD NOT CONVERGE ‼️");

                    break;
                }

                let (mapped, unmappable) =
                    split_unmappable(&source_diagnostics, ctx.note, ctx.world);

                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    mapped,
                    ctx.note,
                    ctx.world,
                ));

                crate::debug!("[ERRORS]: {diagnostics:?}");

                let indicies =
                    remove_errornous_block(blocks, &source_diagnostics, ctx.note, ctx.world);

                if indicies.is_empty() {
                    match remove_unmappable_block::<HtmlDocument>(
                        blocks,
                        &source_diagnostics,
                        ctx.note,
                        ctx.world,
                        &mut probe_budget,
                    ) {
                        Some((index, blamed)) => {
                            // Report the blamed prefix's errors on the block
                            // that caused them, not the whole note.
                            let raw = blamed_raw_range(&blocks[index], ctx.note, ctx.world);
                            let (_, blamed_unmappable) =
                                split_unmappable(&blamed, ctx.note, ctx.world);

                            diagnostics.extend(
                                TypstDiagnostic::from_diagnostics_with_fallback(
                                    blamed_unmappable.into_iter().collect(),
                                    ctx.note,
                                    ctx.world,
                                    Some(&raw),
                                ),
                            );
                        }
                        None => {
                            crate::error!("NO ERROR BLOCKS FOUND ‼️");

                            diagnostics.extend(
                                TypstDiagnostic::from_diagnostics_with_fallback(
                                    unmappable.into_iter().collect(),
                                    ctx.note,
                                    ctx.world,
                                    None,
                                ),
                            );

                            break;
                        }
                    }
                }

                None
            }
        };
    }

    ctx.world.main_id = Some(ctx.note.synth_id);

    if let Some(warnings) = compiled_warnings {
        diagnostics.extend(TypstDiagnostic::from_diagnostics(
            warnings,
            ctx.note,
            ctx.world,
        ));
    }

    (document, diagnostics)
}

/// Diagnostics-only compile of the pristine synth, no recovery.
fn check_html_ctx(ctx: &mut RenderContext<'_>) -> Vec<TypstDiagnostic> {
    let compiled = compile::<HtmlDocument>(ctx.world);
    let mut diagnostics =
        TypstDiagnostic::from_diagnostics(compiled.warnings, ctx.note, ctx.world).into_vec();

    match compiled.output {
        Ok(document) => {
            ctx.note.html_document = Some(document);
        }
        Err(source_diagnostics) => {
            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                source_diagnostics,
                ctx.note,
                ctx.world,
            ));
        }
    }

    diagnostics
}
