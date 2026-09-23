use std::{cmp, collections::VecDeque, ops::Range};

use typst::{
    compile,
    layout::{Abs, FrameItem},
};
use typst_layout::PagedDocument;

use super::frame::{BoundFrameSink, bound_frame};
use crate::{
    bindings::{TypstDiagnostic, TypstFileId},
    renderer::{
        paged::{BoundFrameItem, FrameItemsChunk, PagedRender},
        recovery::{remove_errornous_block, try_mark_errornous},
    },
    source::{
        RenderTarget, SegmentKind, Side, SourceContext, SynthBlock, SynthResult,
        delimiter_diagnostics, sync_source_context,
    },
    state::{RenderContext, TypstState},
    world::TypstWorld,
};

/// Chunks a Typst document into renderable blocks by frame items, handling
/// diagnostics and error divergence.
///
/// The compile runs against the disposable render source, so recovery can
/// rewrite it without touching the pristine synth. IDE queries parse the
/// render source too (see `TypstState::hover`), which is why recovery must
/// keep it compilable: blocks get blanked, math spans get placeholders.
pub fn chunk_by_items(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    render_target: RenderTarget,
    state: &mut TypstState,
) -> PagedRender {
    let line_height_ratio = state.get_space_context(id).line_height_ratio;
    let prelude = state.prelude(id, render_target) + prelude + "\n";
    let mut ctx = state.render_context(id).unwrap();

    chunk_by_items_ctx(&mut ctx, text, &prelude, line_height_ratio)
}

/// [`chunk_by_items`] over an explicit render context, so the pipeline only
/// sees the world and this note's source context.
#[typst_macros::time]
pub fn chunk_by_items_ctx(
    ctx: &mut RenderContext<'_>,
    text: &str,
    prelude: &str,
    line_height_ratio: f64,
) -> PagedRender {
    let SynthResult {
        mut blocks,
        equation_ranges,
        ..
    } = sync_source_context(text, prelude.to_owned(), ctx.note, ctx.world);

    // Compile the render source for the rest of this call. The pristine synth
    // stays in the world for hover/autocomplete/jump.
    ctx.world.main_id = Some(ctx.note.render_id);

    let mut divergence = 0_u8;

    let mut render = chunk_by_items_with_blocks(
        &mut blocks,
        &equation_ranges,
        &mut divergence,
        line_height_ratio,
        ctx.note,
        ctx.world,
    );

    ctx.world.main_id = Some(ctx.note.synth_id);

    // If recovery marked ranges, update the patched source IDE queries trace
    // against. The pristine parse source stays untouched; the patch keeps the
    // file compilable without moving spans.
    if !ctx.note.marked_raw_ranges.is_empty() {
        ctx.note.rebuild_ide_source(ctx.world);
    }

    // The repaired document compiles cleanly, so the unclosed-delimiter
    // warnings have to come from the fixup list, not the compiler.
    let mut diagnostics = delimiter_diagnostics(&ctx.note.render_fixups, text);
    diagnostics.append(&mut render.diagnostics);
    render.diagnostics = diagnostics;

    render
}

#[allow(clippy::iter_with_drain)]
#[typst_macros::time]
pub fn chunk_by_items_with_blocks(
    blocks: &mut Vec<SynthBlock>,
    eq_ranges: &[Range<usize>],
    divergence: &mut u8,
    line_height_ratio: f64,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> PagedRender {
    let mut document = None;

    let mut diagnostics = Vec::new();
    let mut compiled_warnings = None;

    let mut chunks = Vec::new();
    let mut tooltips = Vec::new();

    while document.is_none() {
        let compiled = compile::<PagedDocument>(world);
        compiled_warnings = Some(compiled.warnings);

        // crate::log!("[DOING A THING]");

        (chunks, tooltips, document) = match compiled.output {
            Ok(document) => {
                let mut sink = BoundFrameSink::default();
                let mut bound_frame_items = Vec::new();

                for page in document.pages() {
                    for frame_item in page.frame.items() {
                        let frame_block = bound_frame(frame_item, None, &mut sink, context, world);
                        bound_frame_items.extend(frame_block);
                    }
                }

                let mut bound_frame_items = bound_frame_items.into_iter().peekable();

                let mut chunks: Vec<FrameItemsChunk> = Vec::with_capacity(blocks.len());
                let mut remaining_items = Vec::<BoundFrameItem>::new();

                for block in blocks.iter() {
                    let Some(raw_source) = context.raw_source(world) else {
                        continue;
                    };

                    // Block ranges are in repaired-source coordinates. The
                    // editor range must be raw: an inserted closer maps back
                    // to the offset it was inserted at.
                    let repaired_range = &block.range;
                    let raw_range = context.map_repaired_to_raw(repaired_range.start)
                        ..context.map_repaired_to_raw(repaired_range.end);

                    let raw_lines = raw_source.lines();
                    // Fall back to the raw byte value when the boundary is
                    // mid-character rather than panicking away the whole page.
                    let start_utf16 = raw_lines
                        .byte_to_utf16(raw_range.start)
                        .unwrap_or(raw_range.start);
                    let end_utf16 = raw_lines
                        .byte_to_utf16(raw_range.end)
                        .unwrap_or(raw_range.end);
                    let raw_range_utf16 = start_utf16..end_utf16;

                    let synth_range_end =
                        context.map_repaired_to_render(repaired_range.end, Side::After);

                    let mut chunk_items = VecDeque::<BoundFrameItem>::new();
                    let mut deferred_items = Vec::<BoundFrameItem>::new();

                    // Grow the block's bounding box with each item it keeps.
                    let mut bounds = BlockBounds::default();

                    while let Some(frame_block) = bound_frame_items.peek() {
                        if let Some(range) = &frame_block.range {
                            if range.end <= synth_range_end {
                                let frame_block = bound_frame_items.next().unwrap();

                                // crate::log!("{frame_block:#?}");

                                bounds.absorb(&frame_block);

                                for deferred in deferred_items.drain(..) {
                                    bounds.absorb(&deferred);
                                    chunk_items.push_back(deferred);
                                }
                                chunk_items.push_back(frame_block);
                            } else {
                                break;
                            }
                        } else {
                            let frame_block = bound_frame_items.next().unwrap();

                            // Span-less items are generated decoration: a
                            // link underline trails the text it belongs to, a
                            // list marker leads the next item. Overlap with
                            // the chunk so far decides which side it is.
                            let trails = bounds
                                .bottom()
                                .is_some_and(|bottom| frame_block.bounds.min.y <= bottom);

                            if chunk_items.is_empty() || !trails {
                                deferred_items.push(frame_block);
                            } else {
                                bounds.absorb(&frame_block);
                                chunk_items.push_back(frame_block);
                            }
                        }
                    }

                    // Items whose range belongs to another file (e.g. an
                    // `#typbase.embed` include) never match this block's
                    // range, so a block that renders nothing of its own would
                    // drop them all and the embedded page vanished. Give them
                    // a chunk mapped to the include line instead.
                    if chunk_items.is_empty() && !deferred_items.is_empty() {
                        for deferred in deferred_items.drain(..) {
                            bounds.absorb(&deferred);
                            chunk_items.push_back(deferred);
                        }
                    }

                    // The editor draws the source text on its line baseline.
                    // Crop to the editor's line box: the first line's top (the
                    // text ascender plus the half-leading) down to the last
                    // line's bottom. That keeps a single-line chunk exactly as
                    // tall as its source line, so a heading (whose CSS line box
                    // is larger than its Typst box) does not grow the pane when
                    // its source appears. The top is clamped to what is
                    // actually painted: the synth's 0pt-stroke wrapper and tag
                    // positions do not count, but text, math, images, and
                    // visible shapes do, so tall content never clips. Math
                    // chunks keep their own box so equation spacing does not
                    // change.
                    if !block.math {
                        let mut desired_top: Option<Abs> = None;
                        let mut desired_bottom: Option<Abs> = None;

                        for item in &chunk_items {
                            if let FrameItem::Text(text) = &item.item {
                                let metrics = text.font.metrics();
                                let ascender = metrics.ascender.at(text.size);
                                let descender = metrics.descender.at(text.size);
                                let half = (Abs::pt(line_height_ratio * text.size.to_pt())
                                    - (ascender - descender))
                                    / 2.0;

                                let top = item.point.y - ascender - half;
                                let bottom = item.point.y - descender + half;

                                desired_top = Some(desired_top.map_or(top, |it| it.min(top)));
                                desired_bottom =
                                    Some(desired_bottom.map_or(bottom, |it| it.max(bottom)));
                            }
                        }

                        if let Some(desired) = desired_top {
                            let painted_top = chunk_items
                                .iter()
                                .filter(|item| clamps_crop_top(&item.item))
                                .map(|item| item.bounds.min.y)
                                .min();
                            let start = painted_top.map_or(desired, |top| top.min(desired));

                            bounds.start_height = Some(start);
                        }

                        if let Some(bottom) = desired_bottom {
                            bounds.end_height =
                                Some(bounds.end_height.map_or(bottom, |it| it.max(bottom)));
                        }
                    }

                    let block_start_width = bounds.start_width.unwrap_or_default().to_pt();
                    let block_start_height = bounds.start_height.unwrap_or_default().to_pt();
                    let block_end_width = bounds.end_width.unwrap_or_default().to_pt();
                    let block_end_height = bounds.end_height.unwrap_or_default().to_pt();

                    match context.height {
                        Some(height) if block_start_height >= height => {
                            break;
                        }
                        _ => {}
                    }

                    if block.inline {
                        let length = remaining_items.len();
                        chunk_items.reserve(length.saturating_add(1));

                        for remaining in remaining_items.drain(..).rev() {
                            chunk_items.push_front(remaining);
                        }
                    }

                    remaining_items.append(&mut deferred_items);

                    // crate::log!("start width: {block_start_width}");
                    // crate::log!("end width: {block_end_width}");

                    let block_width = block_end_width - block_start_width;
                    let block_height = block_end_height - block_start_height;

                    if block_width <= 0_f64 || block_height <= 0_f64 {
                        continue;
                    }

                    // The compiled spacing between two list items is not ink,
                    // so neither chunk's bounds contain it, and the editor
                    // stacks chunks by height with no page offsets. Hand the
                    // gap to the upper item's widget: it is the only place it
                    // can live, and it is what makes `list(spacing:)` visible.
                    // Only between items: the space below the last item is the
                    // boundary with the following block, and folding it in
                    // stretches the item's widget past its text.
                    if let Some(previous) = chunks.last_mut()
                        && previous.list_item
                        && block.list_item
                        && block_start_height > previous.y_offset + previous.height
                    {
                        previous.height = block_start_height - previous.y_offset;
                    }

                    chunks.push(FrameItemsChunk {
                        items: chunk_items,
                        range: raw_range_utf16,
                        width: block_width,
                        height: block_height,
                        x_offset: block_start_width,
                        y_offset: block_start_height,
                        list_item: block.list_item,
                    });
                }

                if !remaining_items.is_empty()
                    && let Some(chunk) = chunks.last_mut()
                {
                    let length = remaining_items.len();
                    chunk.items.reserve(length.saturating_add(1));

                    for remaining in remaining_items.drain(..).rev() {
                        chunk.items.push_front(remaining);
                    }
                }

                (chunks, sink.tooltips, Some(document))
            }
            Err(source_diagnostics) => {
                *divergence += 1;
                if *divergence >= 5 {
                    crate::error!("COULD NOT CONVERGE AFTER 5 ITERATIONS ‼️");

                    break;
                }

                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics.clone(),
                    context,
                    world,
                ));

                crate::error!("[ERRORS]: {diagnostics:?}");

                let marked_errors =
                    try_mark_errornous(&source_diagnostics, eq_ranges, context, world);

                if !marked_errors.marks.is_empty() {
                    let marked_render = chunk_by_items_with_blocks(
                        blocks,
                        eq_ranges,
                        divergence,
                        line_height_ratio,
                        context,
                        world,
                    );

                    for mark in &marked_errors.marks {
                        // Replace the marked span with an equal-length
                        // placeholder. Positions stay put, so the document
                        // this produces can back hover/jump while the marked
                        // chunks above keep the red markers.
                        let byte_length = mark.synth_range.len();
                        let placeholder = format!("{:>byte_length$}", "\"\"");
                        let source = context.render_source_mut(world).unwrap();
                        source.edit(mark.synth_range.clone(), &placeholder);
                        context.render_map.replace(
                            mark.synth_range.clone(),
                            &placeholder,
                            SegmentKind::ErrorMark,
                        );
                    }

                    let stable_render = chunk_by_items_with_blocks(
                        blocks,
                        eq_ranges,
                        divergence,
                        line_height_ratio,
                        context,
                        world,
                    );

                    // The render source stays at the placeholder text. The
                    // next sync rebuilds it from the raw source, so there is
                    // nothing to restore here; the pristine synth was never
                    // touched.
                    return PagedRender {
                        chunks: marked_render.chunks,
                        tooltips: marked_render.tooltips,
                        diagnostics,
                        document: stable_render.document,
                    };
                }

                let indicies = remove_errornous_block(blocks, &source_diagnostics, context, world);

                if indicies.is_empty() {
                    crate::error!("NO ERROR BLOCKS FOUND ‼️");
                    break;
                }

                for idx in indicies.iter().rev() {
                    blocks.remove(*idx);
                }

                (Vec::new(), Vec::new(), None)
            }
        };
    }

    if let Some(warnings) = compiled_warnings {
        diagnostics.extend(TypstDiagnostic::from_diagnostics(warnings, context, world));
    }

    // context.synth_source_mut(world).unwrap().replace(&ir);

    let tooltips = tooltips
        .into_iter()
        .filter_map(|items| {
            let mut block_start_width = None;
            let mut block_start_height = None;
            let mut block_end_width = None;
            let mut block_end_height = None;

            for block in &items {
                match block_start_height {
                    Some(height) if height < block.bounds.min.y => {}
                    _ => block_start_height = Some(block.bounds.min.y),
                }

                match block_end_height {
                    Some(height) if height > block.bounds.max.y => {}
                    _ => block_end_height = Some(block.bounds.max.y),
                }

                if !matches!(block.item, FrameItem::Tag(..)) {
                    match block_start_width {
                        Some(width) if width < block.bounds.min.x => {}
                        _ => block_start_width = Some(block.bounds.min.x),
                    }

                    match block_end_width {
                        Some(width) if width > block.bounds.max.x => {}
                        _ => block_end_width = Some(block.bounds.max.x),
                    }
                }
            }

            let block_start_width = block_start_width?.to_pt();
            let block_start_height = block_start_height?.to_pt();
            let block_end_width = block_end_width?.to_pt();
            let block_end_height = block_end_height?.to_pt();

            // Empty content reports an infinite bounding box (Typst uses
            // `Rect` at +/-inf for "nothing here"). Chunks get filtered by the
            // positivity check in the partition loop; tooltips need the same
            // guard or the SVG renderer asserts on a non-finite size.
            let width = block_end_width - block_start_width;
            let height = block_end_height - block_start_height;

            if !width.is_finite()
                || !height.is_finite()
                || !block_start_width.is_finite()
                || !block_start_height.is_finite()
                || width <= 0.0
                || height <= 0.0
            {
                return None;
            }

            let synth_range = items
                .iter()
                .filter_map(|item| item.range.clone())
                .fold(None::<Range<usize>>, |range, item_range| {
                    Some(match range {
                        Some(range) => {
                            let start = cmp::min(range.start, item_range.start);
                            let end = cmp::max(range.end, item_range.end);

                            start..end
                        }
                        None => item_range,
                    })
                })
                .unwrap_or(0..0);

            let raw_start = context.map_render_to_raw(synth_range.start);
            let raw_end = context.map_render_to_raw(synth_range.end);

            // crate::log!("raw_range: {:?}", raw_start..raw_end);

            let raw_source = context.raw_source(world)?;
            let source_len = raw_source.text().len();

            let raw_lines = raw_source.lines();
            // Pad by one byte so the editor range covers the whole first/last
            // token. A block at offset 0 (the date heading of a daily note,
            // say) must not underflow; neither may the end pad run past the
            // source. When the padded boundary lands mid-character (multibyte
            // text), fall back to the exact boundary rather than dropping the
            // block from the editor map.
            let raw_start_utf16 = raw_lines
                .byte_to_utf16(raw_start.saturating_sub(1))
                .or_else(|| raw_lines.byte_to_utf16(raw_start))?;
            let raw_end_utf16 = raw_lines
                .byte_to_utf16(raw_end.saturating_add(1).min(source_len))
                .or_else(|| raw_lines.byte_to_utf16(raw_end))?;
            let raw_range_utf16 = raw_start_utf16..raw_end_utf16;

            // crate::log!("raw_range_utf16: {:?}", raw_start_utf16..raw_end_utf16);

            Some(FrameItemsChunk {
                items: VecDeque::from(items),
                range: raw_range_utf16,
                width,
                height,
                x_offset: block_start_width,
                y_offset: block_start_height,
                // Tooltip chunks are overlays, not stacked content.
                list_item: false,
            })
        })
        .collect();

    // crate::log!("tooltips: {tooltips:#?}");

    PagedRender {
        chunks,
        tooltips,
        diagnostics,
        document,
    }
}

/// Whether a frame item paints anything, and so has to stay inside its
/// chunk's crop. The synth wraps every block in a `#block(stroke: 0pt)`, and
/// tags are position markers; neither draws, so they do not clamp the top.
fn clamps_crop_top(item: &FrameItem) -> bool {
    match item {
        FrameItem::Text(_) | FrameItem::Image(..) | FrameItem::Group(..) => true,
        FrameItem::Shape(shape, _) => {
            shape.fill.is_some()
                || shape
                    .stroke
                    .as_ref()
                    .is_some_and(|stroke| stroke.thickness != Abs::zero())
        }
        FrameItem::Link(..) | FrameItem::Tag(..) => false,
    }
}

/// Running bounding box for one chunk's items.
#[derive(Default)]
struct BlockBounds {
    start_width: Option<Abs>,
    start_height: Option<Abs>,
    end_width: Option<Abs>,
    end_height: Option<Abs>,
}

impl BlockBounds {
    /// Grows the box to include one item.
    fn absorb(&mut self, block: &BoundFrameItem) {
        self.start_width = Some(
            self.start_width
                .map_or(block.bounds.min.x, |width| width.min(block.bounds.min.x)),
        );
        self.start_height = Some(
            self.start_height
                .map_or(block.bounds.min.y, |height| height.min(block.bounds.min.y)),
        );
        self.end_width = Some(
            self.end_width
                .map_or(block.bounds.max.x, |width| width.max(block.bounds.max.x)),
        );
        self.end_height = Some(
            self.end_height
                .map_or(block.bounds.max.y, |height| height.max(block.bounds.max.y)),
        );
    }

    /// Bottom edge of the box, if anything was absorbed.
    fn bottom(&self) -> Option<Abs> {
        self.end_height
    }
}
