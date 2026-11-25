// pub mod blocks;
mod frame;
pub mod items;
pub mod svg;
mod text;

use std::{
    collections::{HashSet, VecDeque},
    hash::Hash,
    ops::Range,
};

use rustc_hash::FxBuildHasher;
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
    source::{
        FrameText, FrameTextFrame, RenderTarget, SynthLayout, sync_source_state,
        sync_source_state_with_layout,
    },
    state::{RenderContext, TypstState},
};

/// Result of paged rendering, containing chunks, diagnostics, and document context.
#[derive(Debug)]
pub struct PagedRender {
    /// Chunks of blocks for incremental rendering.
    pub chunks: Vec<FrameItemsChunk>,
    /// Searchable text and glyph boxes for each chunk, in chunk order.
    pub text: Vec<FrameTextFrame>,
    /// Tooltips for the rendered content.
    pub tooltips: Vec<FrameItemsChunk>,
    /// The equation overlays this render walked, with the items that belong to each. The
    /// error-recovery path re-renders through [`items::chunk_by_items_with_blocks`],
    /// so the tooltips have to be built from the render that produced the chunks
    /// they sit next to, not from the one that asked for them.
    pub(crate) overlays: Vec<EquationOverlay>,
    /// Diagnostics and warnings produced during rendering.
    pub diagnostics: Vec<TypstDiagnostic>,
    /// The paged Typst document, if available.
    pub document: Option<PagedDocument>,
}

/// One equation overlay opened by an introspectable `equation` tag, with the
/// items that belong to it.
#[derive(Debug, Clone)]
pub struct EquationOverlay {
    /// The overlay this one was laid out inside, if any.
    pub(crate) parent: Option<usize>,
    /// The equation's range in the render source, resolved while the walk that
    /// produced it was still the state of the world.
    pub(crate) range: Option<Range<usize>>,
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
    /// Distance from the chunk's top to the topmost prose line box's top, in
    /// points. Nonzero when something taller than text (inline math, an image,
    /// a box) sets the top of the crop.
    pub text_top: f64,
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
    /// The innermost equation overlay this item was laid out inside, if any.
    ///
    /// This is a layout fact, not a source one. A `let`-bound equation's items
    /// have the *definition's* spans while being laid out at each use, so
    /// [`range`](Self::range) cannot say which equation they belong to. The
    /// tag stack can, and an equation's overlay also claims the items of every
    /// overlay nested in it.
    pub equation: Option<usize>,
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
    ///
    /// `known_frames` lists frame hashes whose SVG the caller already has. Those
    /// frames come back with `svg: ""` and the caller fills them from its cache.
    /// Sharing definitions still covers them.
    #[wasm_bindgen(js_name = "compilePaged")]
    pub fn compile_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
        caret: Option<usize>,
        include_tooltips: Option<bool>,
        known_frames: Option<Vec<u32>>,
    ) -> Result<Ts<CompilePagedResult>, JsError> {
        let known: Option<HashSet<u32, FxBuildHasher>> =
            known_frames.map(|frames| frames.into_iter().collect());
        let result = svg::render_svgs_by_items_with_known(
            id,
            text,
            prelude,
            caret,
            include_tooltips.unwrap_or(true),
            known.as_ref(),
            self,
        );

        Ok(CompilePagedResult {
            frames: result.frames,
            tooltips: result.tooltips,
            defs: result.defs,
            equation_ranges: result.equation_ranges,
            diagnostics: result.diagnostics,
            requests: self.world.take_requests(),
        }
        .into_ts()?)
    }

    /// Visible text and glyph boxes from the last paged render, for page
    /// search. The frames array matches the last `compilePaged` result.
    #[wasm_bindgen(js_name = "frameText")]
    pub fn frame_text(&self, id: &TypstFileId) -> Result<Ts<FrameText>, JsError> {
        Ok(self.get_source_context(id).frame_text.clone().into_ts()?)
    }

    /// Layout hash of the last frame index, without cloning the index itself.
    /// `None` when find text is off or no paged render has landed.
    #[wasm_bindgen(js_name = "frameTextHash")]
    pub fn frame_text_hash(&self, id: &TypstFileId) -> Option<u32> {
        let frame_text = &self.get_source_context(id).frame_text;

        (!frame_text.frames.is_empty()).then_some(frame_text.layout_hash)
    }

    /// Turns the frame text index on or off for this note. Page find enables
    /// it while open and clears the old index when closing.
    #[wasm_bindgen(js_name = "setFindText")]
    pub fn set_find_text(&mut self, id: &TypstFileId, enabled: bool) {
        let context = self.get_source_context_mut(id);
        context.find_text = enabled;
        if !enabled {
            context.frame_text = Default::default();
        }
    }

    /// Diagnostics for the current text, through the same error recovery the
    /// render uses, without rendering frames and without publishing a document.
    #[wasm_bindgen(js_name = "diagnosePaged")]
    pub fn diagnose_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CheckResult>, JsError> {
        let line_height_ratio = self.get_space_context(id).line_height_ratio;
        let prelude = self.prelude(id, RenderTarget::Svg) + prelude + "\n";
        let mut ctx = self.render_context(id).unwrap();

        let render =
            items::chunk_by_items_ctx(&mut ctx, text, &prelude, None, false, line_height_ratio);

        Ok(CheckResult {
            diagnostics: render.diagnostics,
            requests: ctx.world.take_requests(),
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
    /// PDF export. The caller sets the page width through `resize`.
    /// `preserve_lines` keeps the editor's wrapped block layout.
    #[wasm_bindgen(js_name = "renderSvg")]
    pub fn render_svg(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
        merged: bool,
        preserve_lines: Option<bool>,
    ) -> Result<Ts<crate::bindings::RenderSvgResult>, JsError> {
        sync_source_state_with_layout(
            id,
            text,
            prelude,
            RenderTarget::Pdf,
            SynthLayout::document(preserve_lines.unwrap_or(false)),
            self,
        );

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
    /// Returns the PDF bytes plus diagnostics. The caller uploads the bytes
    /// as a blob on `at.typbase.post`.
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(js_name = "renderPdf")]
    pub fn render_pdf(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
        preserve_lines: Option<bool>,
    ) -> Result<Ts<RenderPdfResult>, JsError> {
        use typst_pdf::{PdfOptions, pdf};

        sync_source_state_with_layout(
            id,
            text,
            prelude,
            RenderTarget::Pdf,
            SynthLayout::document(preserve_lines.unwrap_or(false)),
            self,
        );

        let mut ctx = self.render_context(id).unwrap();
        // Exports get the delimiter repair too. They compile the render source.
        let (document, mut diagnostics) = compile_export_document(&mut ctx);

        let bytes = match document {
            Some(document) => {
                match pdf(&document, &PdfOptions::default()) {
                    Ok(pdf) => Some(pdf),
                    Err(source_diagnostics) => {
                        diagnostics.extend(TypstDiagnostic::from_diagnostics(
                            source_diagnostics,
                            ctx.note,
                            ctx.world,
                        ));
                        None
                    }
                }
            }
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

/// The pristine check, reachable from outside the crate.
pub fn check_pristine(ctx: &mut RenderContext<'_>) -> Vec<TypstDiagnostic> {
    check_paged_ctx(ctx)
}

/// Diagnostics-only compile of the pristine synth. Recovery is deliberately
/// skipped: the editor's warnings must describe the user's text.
fn check_paged_ctx(ctx: &mut RenderContext<'_>) -> Vec<TypstDiagnostic> {
    let compiled = compile::<PagedDocument>(ctx.world);
    let mut diagnostics =
        TypstDiagnostic::from_diagnostics(compiled.warnings, ctx.note, ctx.world).into_vec();

    match compiled.output {
        Ok(_) => {}
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
