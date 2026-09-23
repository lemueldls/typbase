// pub mod blocks;
mod frame;
pub mod items;
pub mod svg;

use std::{collections::VecDeque, hash::Hash, ops::Range};

use tsify::{Ts, Tsify};
use typst::{
    compile,
    layout::{Abs, FrameItem, Point, Rect},
};
use typst_layout::PagedDocument;
use typst_svg::SvgOptions;
use wasm_bindgen::prelude::*;

#[cfg(feature = "pdf")]
use crate::bindings::RenderPdfResult;
use crate::{
    bindings::{CheckResult, CompilePagedResult, TypstDiagnostic, TypstFileId},
    source::{RenderTarget, sync_source_state},
    state::{RenderContext, TypstState},
};

/// Result of paged rendering, containing chunks, diagnostics, and document context.
#[derive(Debug)]
pub struct PagedRender {
    /// Chunks of blocks for incremental rendering.
    pub chunks: Vec<FrameItemsChunk>,
    /// Tooltips for the rendered content.
    pub tooltips: Vec<FrameItemsChunk>,
    /// Diagnostics and warnings produced during rendering.
    pub diagnostics: Vec<TypstDiagnostic>,
    /// The paged Typst document, if available.
    pub document: Option<PagedDocument>,
}

/// A chunk of frame items, representing a logical segment of the document.
#[derive(Debug)]
pub struct FrameItemsChunk {
    /// The bound frame items in this chunk.
    pub items: VecDeque<BoundFrameItem>,
    /// UTF-16 range in the source corresponding to this chunk.
    pub range: Range<usize>,
    /// Width of the chunk in points.
    pub width: f64,
    /// Height of the chunk in points.
    pub height: f64,
    /// Offset from the left of the page in points.
    pub x_offset: f64,
    /// Offset from the top of the page in points.
    pub y_offset: f64,
    /// True for a list, enum, or term item. `height` includes the compiled
    /// spacing down to the next item, so the editor's stack of widgets
    /// reproduces the item stride instead of squeezing the spacing out.
    pub list_item: bool,
}

/// A single frame item with bounds and range.
#[derive(Debug, Clone)]
pub struct BoundFrameItem {
    /// Optional byte range in the source for this block.
    pub range: Option<Range<usize>>,
    /// Bounding box of the block.
    pub bounds: Rect,
    /// The frame item to render.
    pub item: FrameItem,
    /// The position of the block on the page.
    pub point: Point,
}

impl Hash for BoundFrameItem {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        // self.range.hash(state);
        // self.start_height.hash(state);
        // self.end_height.hash(state);
        self.item.hash(state);
        self.point.hash(state);
    }
}

#[wasm_bindgen]
impl TypstState {
    /// The editor's paged render: one SVG frame per source chunk, plus the
    /// tooltip frames and diagnostics the editor needs.
    #[wasm_bindgen(js_name = "compilePaged")]
    pub fn compile_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CompilePagedResult>, JsError> {
        let result = svg::render_svgs_by_items(id, text, prelude, self);

        Ok(CompilePagedResult {
            frames: result.frames,
            tooltips: result.tooltips,
            diagnostics: result.diagnostics,
            requests: self.world.take_requests(),
        }
        .into_ts()?)
    }

    /// Diagnostics-only pass: compile the pristine synth, no recovery.
    #[wasm_bindgen(js_name = "checkPaged")]
    pub fn check_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CheckResult>, JsError> {
        sync_source_state(id, text, prelude, RenderTarget::Svg, self);

        let mut ctx = self.render_context(id).unwrap();
        let diagnostics = check_paged_ctx(&mut ctx);

        Ok(CheckResult {
            diagnostics,
            requests: ctx.world.take_requests(),
        }
        .into_ts()?)
    }

    /// SVG export of the paged document: one entry per page, or a single
    /// merged document. Uses the PDF page geometry so the sheets match the
    /// PDF export; the caller sets the page width through `resize`.
    #[wasm_bindgen(js_name = "renderSvg")]
    pub fn render_svg(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
        merged: bool,
    ) -> Result<Ts<crate::bindings::RenderSvgResult>, JsError> {
        sync_source_state(id, text, prelude, RenderTarget::Pdf, self);

        let mut ctx = self.render_context(id).unwrap();
        // Same render source as the PDF export so the SVG sheets and the PDF
        // agree on page geometry and repaired delimiters.
        let (document, diagnostics) = compile_export_document(&mut ctx);

        let pages = match document {
            Some(document) => {
                let options = SvgOptions::default();
                if merged {
                    vec![typst_svg::svg_merged(&document, &options, Abs::pt(12.0))]
                } else {
                    document
                        .pages()
                        .iter()
                        .map(|page| typst_svg::svg(page, &options))
                        .collect()
                }
            }
            None => Vec::new(),
        };

        Ok(crate::bindings::RenderSvgResult {
            pages,
            diagnostics,
            requests: ctx.world.take_requests(),
        }
        .into_ts()?)
    }

    /// PDF publishing, compiled only when the `pdf` cargo feature is on.
    /// Returns the PDF bytes plus diagnostics; the caller uploads the bytes
    /// as a blob on `at.typbase.post`.
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(js_name = "renderPdf")]
    pub fn render_pdf(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<RenderPdfResult>, JsError> {
        use typst_pdf::{PdfOptions, pdf};

        sync_source_state(id, text, prelude, RenderTarget::Pdf, self);

        let mut ctx = self.render_context(id).unwrap();
        // Exports get the delimiter repair too; they compile the render source.
        let (document, mut diagnostics) = compile_export_document(&mut ctx);

        let bytes = match document {
            Some(document) => match pdf(&document, &PdfOptions::default()) {
                Ok(pdf) => Some(pdf),
                Err(source_diagnostics) => {
                    diagnostics.extend(TypstDiagnostic::from_diagnostics(
                        source_diagnostics,
                        ctx.note,
                        ctx.world,
                    ));
                    None
                }
            },
            None => None,
        };

        Ok(RenderPdfResult {
            bytes,
            diagnostics,
            requests: ctx.world.take_requests(),
        }
        .into_ts()?)
    }

    /// False when the shipped wasm build omits the pdf feature (the default).
    #[wasm_bindgen(js_name = "pdfAvailable")]
    #[must_use]
    pub fn pdf_available(&self) -> bool {
        cfg!(feature = "pdf")
    }
}

/// Diagnostics-only compile of the pristine synth. Recovery is deliberately
/// skipped: the editor's warnings must describe the user's text.
fn check_paged_ctx(ctx: &mut RenderContext<'_>) -> Vec<TypstDiagnostic> {
    let compiled = compile::<PagedDocument>(ctx.world);
    let mut diagnostics =
        TypstDiagnostic::from_diagnostics(compiled.warnings, ctx.note, ctx.world).into_vec();

    match compiled.output {
        Ok(document) => {
            ctx.note.paged_document = Some(document);
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

/// Compiles the render source for an export and returns the document plus
/// diagnostics. SVG and PDF exports share page geometry and delimiter repair.
fn compile_export_document(
    ctx: &mut RenderContext<'_>,
) -> (Option<PagedDocument>, Vec<TypstDiagnostic>) {
    ctx.world.main_id = Some(ctx.note.render_id);

    let compiled = compile::<PagedDocument>(ctx.world);

    ctx.world.main_id = Some(ctx.note.synth_id);
    let mut diagnostics =
        TypstDiagnostic::from_diagnostics(compiled.warnings, ctx.note, ctx.world).into_vec();

    let document = match compiled.output {
        Ok(document) => Some(document),
        Err(source_diagnostics) => {
            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                source_diagnostics,
                ctx.note,
                ctx.world,
            ));
            None
        }
    };

    (document, diagnostics)
}
