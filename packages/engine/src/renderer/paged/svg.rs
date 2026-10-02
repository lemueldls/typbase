use std::{
    collections::{HashSet, VecDeque},
    hash::BuildHasher,
    ops::Range,
};

use comemo::{Prehashed, Track, Tracked};
use rustc_hash::FxBuildHasher;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use typst::{
    layout::{Abs, Frame, Point, Size},
    model::LateLinkResolver,
};
use typst_svg::svg_in_html;

use super::BoundFrameItem;
use crate::{
    bindings::{TypstDiagnostic, TypstFileId},
    renderer::paged::{
        PagedRender,
        items::{TooltipFocus, chunk_by_items_ctx},
    },
    source::RenderTarget,
    state::{RenderContext, TypstState},
};

/// Renders SVG frames for each chunked item in a Typst document.
pub fn render_svgs_by_items(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    focus: TooltipFocus,
    state: &mut TypstState,
) -> SvgRender {
    let line_height_ratio = state.get_space_context(id).line_height_ratio;
    let prelude = state.prelude(id, RenderTarget::Svg) + prelude + "\n";
    let mut ctx = state.render_context(id).unwrap();

    render_svgs_by_items_ctx(&mut ctx, text, &prelude, focus, line_height_ratio)
}

/// [`render_svgs_by_items`] over an explicit render context.
#[typst_macros::time]
pub fn render_svgs_by_items_ctx(
    ctx: &mut RenderContext<'_>,
    text: &str,
    prelude: &str,
    focus: TooltipFocus,
    line_height_ratio: f64,
) -> SvgRender {
    let PagedRender {
        chunks,
        tooltips,
        overlays: _,
        diagnostics,
        document,
    } = chunk_by_items_ctx(ctx, text, prelude, focus, line_height_ratio);

    let equation_ranges = equation_ranges_utf16(ctx);

    let (frames, tooltips) = if let Some(document) = &document {
        let link_resolver = LateLinkResolver::new(None, document.introspector().as_ref());
        let link_resolver = link_resolver.track();

        let document_width = document
            .pages()
            .iter()
            .map(|page| page.frame.width())
            .max()
            .unwrap_or_default();

        let frames = chunks
            .into_iter()
            .map(|chunk| {
                let items = Prehashed::new(chunk.items);

                let width = Abs::pt(chunk.width);
                let height = Abs::pt(chunk.height);
                let x_offset = Abs::pt(chunk.x_offset);
                let y_offset = Abs::pt(chunk.y_offset);

                render_svg(
                    items,
                    chunk.range,
                    width,
                    height,
                    x_offset,
                    y_offset,
                    document_width,
                    link_resolver,
                )
            })
            .collect();

        let tooltips = tooltips
            .into_iter()
            .map(|chunk| {
                let items = Prehashed::new(chunk.items);

                let width = Abs::pt(chunk.width);
                let height = Abs::pt(chunk.height);
                let x_offset = Abs::pt(chunk.x_offset);
                let y_offset = Abs::pt(chunk.y_offset);

                render_svg(
                    items,
                    chunk.range,
                    width,
                    height,
                    x_offset,
                    y_offset,
                    width,
                    link_resolver,
                )
            })
            .collect();

        (frames, tooltips)
    } else {
        (Vec::new(), Vec::new())
    };

    ctx.note.paged_document = document;

    let mut frames = frames;
    let defs = share_frame_defs(&mut frames);

    SvgRender {
        frames,
        tooltips,
        defs,
        equation_ranges,
        diagnostics,
    }
}

/// Every equation's range in the editor's raw UTF-16 coordinates.
///
/// The overlays are only built for the equation under the cursor, so the editor
/// cannot learn where the rest of the note's math is from them. It needs the
/// ranges to notice that the cursor has moved into an equation whose overlay the
/// last render skipped.
fn equation_ranges_utf16(ctx: &RenderContext<'_>) -> Vec<[usize; 2]> {
    let RenderContext { world, note } = ctx;

    let Some(raw_source) = note.raw_source(world) else {
        return Vec::new();
    };

    let ranges = note.last_equation_ranges();
    let lines = raw_source.lines();
    let len = raw_source.text().len();

    ranges
        .iter()
        .filter_map(|range| {
            let start = note.map_repaired_to_raw(range.start).min(len);
            let end = note.map_repaired_to_raw(range.end).min(len);
            Some([lines.byte_to_utf16(start)?, lines.byte_to_utf16(end)?])
        })
        .collect()
}

/// Close tags of the elements the SVG exporter writes inside a `<defs>` block.
const DEFS_CLOSE_TAGS: [&str; 5] = [
    "</symbol>",
    "</clipPath>",
    "</linearGradient>",
    "</radialGradient>",
    "</pattern>",
];

/// The exporter writes `<defs>` with no attributes, so the literal tags match.
/// A test pins that too, since a mismatch would either leave the duplicated
/// defs in place or cut into a frame's own markup.
const DEFS_OPEN: &str = "<defs>";
const DEFS_CLOSE: &str = "</defs>";

/// The span of every `<defs>` block in `svg`, tags included, in document order.
///
/// An unterminated block, which the exporter does not produce, ends the scan and
/// leaves the rest of the string in place.
fn defs_block_spans(svg: &str) -> Vec<Range<usize>> {
    let mut spans = Vec::new();
    let mut from = 0;

    while let Some(open) = svg[from..].find(DEFS_OPEN) {
        let after_open = open + DEFS_OPEN.len();
        let Some(close) = svg[after_open..].find(DEFS_CLOSE) else {
            break;
        };

        spans.push(open..after_open + close + DEFS_CLOSE.len());
        from = after_open + close + DEFS_CLOSE.len();
    }

    spans
}

/// The contents of one `<defs>` block, without its tags.
fn defs_inner<'a>(svg: &'a str, block: &Range<usize>) -> &'a str {
    &svg[block.start + DEFS_OPEN.len()..block.end - DEFS_CLOSE.len()]
}

/// The SVG with the given `<defs>` blocks removed.
///
/// The spans are the blocks whole, so an empty block disappears rather than
/// leaving `<defs></defs>` behind in every frame.
fn strip_defs(svg: &str, blocks: &[Range<usize>]) -> String {
    let mut stripped = String::with_capacity(svg.len());
    let mut rest = 0;

    for block in blocks {
        if block.start < rest || block.end > svg.len() {
            continue;
        }

        stripped.push_str(&svg[rest..block.start]);
        rest = block.end;
    }

    stripped.push_str(&svg[rest..]);
    stripped
}

/// Splits the concatenated contents of `<defs>` blocks into whole elements.
///
/// One scan for the next close and then a name match. Asking `find` for each tag
/// instead would rescan everything after the current element once per element,
/// and a frame's definitions hold twenty-odd of them, which cost more than the
/// deduplication saves on a short note.
fn split_def_elements(inner: &str) -> Vec<&str> {
    let mut elements = Vec::new();
    let mut start = 0;
    let mut from = 0;

    while let Some(offset) = inner[from..].find("</") {
        let at = from + offset;

        let Some(tag) = DEFS_CLOSE_TAGS
            .iter()
            .find(|tag| inner[at..].starts_with(**tag))
        else {
            // A close this build does not know ends nothing. Skip it and keep
            // looking; the element it belonged to rides along with the next one,
            // which is harmless because the union is a plain concatenation.
            from = at + 2;
            continue;
        };

        let end = at + tag.len();
        elements.push(&inner[start..end]);
        start = end;
        from = end;
    }

    elements
}

/// The `id` of one definition element.
fn def_id(element: &str) -> Option<&str> {
    let at = element.find("id=\"")? + "id=\"".len();
    let end = element[at..].find('"')? + at;

    Some(&element[at..end])
}

/// The `id` of every element in a block of definitions.
fn def_ids(inner: &str) -> HashSet<&str> {
    let mut ids = HashSet::new();
    let mut rest = inner;

    while let Some(at) = rest.find("id=\"") {
        rest = &rest[at + "id=\"".len()..];
        if let Some(end) = rest.find('"') {
            ids.insert(&rest[..end]);
            rest = &rest[end..];
        }
    }

    ids
}

/// The ids a block of SVG markup references through `href="#…"`.
fn referenced_ids(svg: &str) -> HashSet<&str> {
    let mut ids = HashSet::new();
    let mut rest = svg;

    while let Some(at) = rest.find("href=\"#") {
        rest = &rest[at + "href=\"#".len()..];
        if let Some(end) = rest.find('"') {
            ids.insert(&rest[..end]);
            rest = &rest[end..];
        }
    }

    ids
}

/// Moves a frame set's glyph, gradient, and clip-path definitions into one
/// shared block.
///
/// Every frame gets a private `<defs>` from the exporter, so a prose note writes
/// the same outline once per block that uses the character. Measured on a
/// six-block note: 78 symbol copies, 18 unique, so 77% of the SVG payload is
/// duplicated, and a 3000-block note costs 45 MB of markup where roughly 8 MB is
/// real content.
///
/// The soundness rests on the exporter naming a definition `hash128` of
/// `(font, glyph, scale)`, so an id names one outline no matter which frame wrote
/// it. Two frames that agree on an id cannot disagree about its contents, which
/// is also why a single shared block is safe for the whole app rather than per
/// document.
///
/// Tooltip frames are left alone: they render for whichever equation the caret is
/// in, so their glyphs need not be in this frame set, and a frame set from an
/// earlier compile would leave them blank.
fn share_frame_defs(frames: &mut [SvgRangedFrame]) -> Option<String> {
    // Collect first, strip second: the element slices borrow the frame markup,
    // which the second pass rewrites. The spans come along so the second pass
    // does not scan every frame's body a second time to find them again.
    let mut shared: Vec<&str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut spans: Vec<Vec<Range<usize>>> = Vec::with_capacity(frames.len());

    for frame in frames.iter() {
        let blocks = defs_block_spans(&frame.render.svg);
        spans.push(blocks.clone());

        for block in &blocks {
            for element in split_def_elements(defs_inner(&frame.render.svg, block)) {
                // Keyed on the id rather than the element. A glyph outline runs to
                // a few hundred bytes and a frame set has one per frame, so
                // hashing the whole thing cost more than the deduplication saved.
                // Same id means the same outline (see above), so this is the same
                // test. An element without an id falls back to its own text.
                let key = def_id(element).unwrap_or(element);

                if seen.insert(key) {
                    shared.push(element);
                }
            }
        }
    }

    if shared.is_empty() {
        return None;
    }

    let defs = shared.concat();
    let ids = def_ids(&defs);

    for (frame, blocks) in frames.iter_mut().zip(&spans) {
        if blocks.is_empty() {
            continue;
        }

        let stripped = strip_defs(&frame.render.svg, blocks);

        // A frame keeps its own defs when the union does not cover what it
        // references, which is what makes a wrong split a lost saving instead of
        // missing glyphs.
        if referenced_ids(&stripped).iter().all(|id| ids.contains(id)) {
            frame.render.svg = stripped;
        }
    }

    Some(defs)
}

/// Renders a single SVG frame from a set of frame items and metadata.
#[allow(clippy::too_many_arguments)]
#[comemo::memoize]
#[typst_macros::time]
fn render_svg(
    items: Prehashed<VecDeque<BoundFrameItem>>,
    range: Range<usize>,
    width: Abs,
    height: Abs,
    x_offset: Abs,
    y_offset: Abs,
    document_width: Abs,
    link_resolver: Tracked<LateLinkResolver>,
) -> SvgRangedFrame {
    #[allow(clippy::cast_possible_truncation)]
    let hash = FxBuildHasher.hash_one(&items) as u32;

    let mut frame = Frame::soft(Size::new(document_width, height));
    frame.push_multiple(items.into_inner().into_iter().map(|block| {
        let point = block.point - Point::new(Abs::zero(), y_offset);

        (point, block.item)
    }));

    let svg = svg_in_html(&frame, Abs::pt(1.0), false, None, "", &[], link_resolver);

    let width = width.to_pt();
    let height = height.to_pt();
    let x_offset = x_offset.to_pt();
    let y_offset = y_offset.to_pt();

    let render = SvgFrameRender {
        svg,
        width,
        height,
        x_offset,
        y_offset,
        hash,
    };

    SvgRangedFrame { range, render }
}

/// Result of SVG rendering, containing SVG frames and diagnostics.
#[derive(Debug, Tsify, Serialize, Deserialize)]
pub struct SvgRender {
    /// Rendered SVG frames for each chunk.
    pub frames: Vec<SvgRangedFrame>,
    /// Rendered SVG frames for tooltips. These keep their own definitions.
    pub tooltips: Vec<SvgRangedFrame>,
    /// The definitions [`frames`](Self::frames) reference, which the host has to
    /// place in the document. `None` when the frames drew nothing that needed
    /// any.
    pub defs: Option<String>,
    /// UTF-16 ranges of every equation, rendered or not.
    pub equation_ranges: Vec<[usize; 2]>,
    /// Diagnostics and warnings produced during rendering.
    pub diagnostics: Vec<TypstDiagnostic>,
}

/// An SVG frame with its corresponding source range.
#[derive(Debug, Clone, Tsify, Serialize, Deserialize)]
pub struct SvgRangedFrame {
    /// UTF-16 range in the source for this frame.
    pub range: Range<usize>,
    /// The SVG render data.
    pub render: SvgFrameRender,
}

impl SvgRangedFrame {
    #[must_use]
    pub const fn new(range: Range<usize>, render: SvgFrameRender) -> Self {
        Self { range, render }
    }
}

/// Rendered SVG data for a frame, including metadata.
#[derive(Debug, Clone, Tsify, Serialize, Deserialize)]
pub struct SvgFrameRender {
    /// SVG markup as a string.
    pub svg: String,
    /// Width of the frame in points.
    pub width: f64,
    /// Height of the frame in points.
    pub height: f64,
    /// Offset from the left of the page in points.
    #[serde(rename = "xOffset")]
    pub x_offset: f64,
    /// Hash of the frame items for change detection.
    #[serde(rename = "yOffset")]
    pub y_offset: f64,
    /// Hash of the frame items for change detection.
    pub hash: u32,
}
