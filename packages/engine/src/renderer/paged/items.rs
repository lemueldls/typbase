use std::{collections::VecDeque, ops::Range};

use typst::{
    WorldExt, compile,
    layout::{Abs, FrameItem},
};
use typst_layout::PagedDocument;

use super::frame::{TagStack, bound_frame};
use crate::{
    bindings::{TypstDiagnostic, TypstFileId},
    renderer::{
        paged::{BoundFrameItem, EquationOverlay, FrameItemsChunk, PagedRender},
        recovery::{
            PROBE_BUDGET, blamed_raw_range, remove_errornous_block, remove_unmappable_block,
            split_unmappable, try_mark_errornous,
        },
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
/// The editor's popup shows the equation the cursor is inside, so a caret
/// narrows the overlays to that one equation. `None` builds an overlay for every
/// equation, which is what a caller with no cursor position wants. The value is a
/// raw UTF-16 offset, the position the editor reports.
pub type TooltipFocus = Option<usize>;

pub fn chunk_by_items(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    focus: TooltipFocus,
    render_target: RenderTarget,
    state: &mut TypstState,
) -> PagedRender {
    let line_height_ratio = state.get_space_context(id).line_height_ratio;
    let prelude = state.prelude(id, render_target) + prelude + "\n";
    let mut ctx = state.render_context(id).unwrap();

    chunk_by_items_ctx(&mut ctx, text, &prelude, focus, line_height_ratio)
}

/// [`chunk_by_items`] over an explicit render context, so the pipeline only
/// sees the world and this note's source context.
#[typst_macros::time]
#[allow(clippy::too_many_arguments)]
pub fn chunk_by_items_ctx(
    ctx: &mut RenderContext<'_>,
    text: &str,
    prelude: &str,
    focus: TooltipFocus,
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
        focus,
        &mut divergence,
        line_height_ratio,
        ctx.note,
        ctx.world,
    );

    ctx.world.main_id = Some(ctx.note.synth_id);

    // If recovery marked ranges, update the patched source IDE queries trace
    // against. The pristine parse source stays untouched. The patch keeps the
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
#[allow(clippy::too_many_arguments)]
pub fn chunk_by_items_with_blocks(
    blocks: &mut Vec<SynthBlock>,
    eq_ranges: &[Range<usize>],
    focus: TooltipFocus,
    divergence: &mut u8,
    line_height_ratio: f64,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> PagedRender {
    let mut document = None;

    let mut diagnostics = Vec::new();
    let mut compiled_warnings = None;

    let mut chunks = Vec::new();
    let mut overlays: Vec<EquationOverlay> = Vec::new();

    // Probe compiles the unmappable-error bisection may spend on this render.
    let mut probe_budget = PROBE_BUDGET;

    while document.is_none() {
        let compiled = compile::<PagedDocument>(world);
        compiled_warnings = Some(compiled.warnings);

        // crate::log!("[DOING A THING]");

        (chunks, document) = match compiled.output {
            Ok(document) => {
                // The memo is for this walk only. The loop below rewrites the
                // render source between iterations, and a span from the previous
                // document means something else once the text under it changed.
                context.begin_frame_walk();

                let mut tags = TagStack::default();
                let mut bound_frame_items = Vec::new();

                for page in document.pages() {
                    for frame_item in page.frame.items() {
                        let frame_block = bound_frame(frame_item, None, &mut tags, context, world);
                        bound_frame_items.extend(frame_block);
                    }
                }

                // Resolve the tag spans now, while the world is still the one
                // this compile produced. Error recovery edits the render source
                // below, and a span into an edited region stops resolving, which
                // would drop every overlay in a page that needed recovering.
                overlays = tags
                    .overlays()
                    .iter()
                    .map(|(parent, span)| EquationOverlay {
                        parent: *parent,
                        range: world.range(*span),
                    })
                    .collect();

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

                (chunks, Some(document))
            }
            Err(source_diagnostics) => {
                *divergence += 1;
                if *divergence >= 5 {
                    crate::error!("COULD NOT CONVERGE AFTER 5 ITERATIONS ‼️");

                    break;
                }

                let (mapped, unmappable) =
                    split_unmappable(&source_diagnostics, context, world);

                diagnostics.extend(TypstDiagnostic::from_diagnostics(mapped, context, world));

                crate::debug!("[ERRORS]: {diagnostics:?}");

                let marked_errors =
                    try_mark_errornous(&source_diagnostics, eq_ranges, context, world);

                if !marked_errors.marks.is_empty() {
                    // The marks fix the equation. Unmappable errors belong to
                    // other blocks, so they keep the whole-note range here
                    // rather than holding up the marked render.
                    diagnostics.extend(TypstDiagnostic::from_diagnostics_with_fallback(
                        unmappable.into_iter().collect(),
                        context,
                        world,
                        None,
                    ));

                    let marked_render = chunk_by_items_with_blocks(
                        blocks,
                        eq_ranges,
                        focus,
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
                        focus,
                        divergence,
                        line_height_ratio,
                        context,
                        world,
                    );

                    // The render source stays at the placeholder text. The
                    // next sync rebuilds it from the raw source, so there is
                    // nothing to restore here. The pristine synth was never
                    // touched.
                    //
                    // The marked chunks carry the red markers, so their overlays
                    // come from the walk that produced them rather than from this
                    // frame's own, which is empty: this iteration took the `Err`
                    // arm and never walked a document.
                    let marked_chunks = marked_render.chunks;
                    let marked_overlays = marked_render.overlays;

                    return PagedRender {
                        tooltips: equation_tooltips(
                            &marked_chunks,
                            &marked_overlays,
                            eq_ranges,
                            focus,
                            context,
                            world,
                        ),
                        chunks: marked_chunks,
                        overlays: marked_overlays,
                        diagnostics,
                        document: stable_render.document,
                    };
                }

                let mut indicies =
                    remove_errornous_block(blocks, &source_diagnostics, context, world);

                if indicies.is_empty() {
                    match remove_unmappable_block::<PagedDocument>(
                        blocks,
                        &source_diagnostics,
                        context,
                        world,
                        &mut probe_budget,
                    ) {
                        Some((index, blamed)) => {
                            // Report the blamed prefix's errors on the block
                            // that caused them, not the whole note.
                            let raw = blamed_raw_range(&blocks[index], context, world);
                            let (_, blamed_unmappable) =
                                split_unmappable(&blamed, context, world);

                            diagnostics.extend(
                                TypstDiagnostic::from_diagnostics_with_fallback(
                                    blamed_unmappable.into_iter().collect(),
                                    context,
                                    world,
                                    Some(&raw),
                                ),
                            );

                            indicies.push(index);
                        }
                        None => {
                            crate::error!("NO ERROR BLOCKS FOUND ‼️");

                            diagnostics.extend(
                                TypstDiagnostic::from_diagnostics_with_fallback(
                                    unmappable.into_iter().collect(),
                                    context,
                                    world,
                                    None,
                                ),
                            );

                            break;
                        }
                    }
                }

                for idx in indicies.iter().rev() {
                    blocks.remove(*idx);
                }

                (Vec::new(), None)
            }
        };
    }

    if let Some(warnings) = compiled_warnings {
        diagnostics.extend(TypstDiagnostic::from_diagnostics(warnings, context, world));
    }

    let tooltips = equation_tooltips(&chunks, &overlays, eq_ranges, focus, context, world);

    PagedRender {
        chunks,
        tooltips,
        overlays,
        diagnostics,
        document,
    }
}

/// Builds one overlay chunk per equation, holding the frame items the editor
/// pops up while the cursor is inside that equation.
///
/// The two halves of the answer come from different places, because no single
/// one has both:
///
/// - **Which items belong to an equation** is a layout fact, so it comes from
///   the tag stack's overlays. A `let`-bound equation's items carry the spans of
///   its definition while being laid out at each use, so matching items by source
///   range files them under the definition and leaves every equation that uses
///   the binding with an overlay missing that content. An overlay also claims
///   the items of the overlays nested inside it, so the popup for
///   `$ sum_(k=0)^n xn $` draws the `xn` too.
/// - **Which editor range an overlay covers** is a source fact, so it comes from
///   the synth's AST ranges. The tag span of a `let`-bound equation points at
///   its definition, which is exactly where the popup belongs, but folding item
///   ranges against it would report one range spanning the definition and every
///   use.
///
/// An equation that was never laid out (a binding nothing uses) has no overlay,
/// and one that failed to compile is not in a successful document at all.
///
/// A `focus` caret keeps only the equation holding it. Every equation's overlay
/// is a rendered SVG, and an editor shows at most one, so building all of them
/// spends the whole note's math budget on keystrokes that display none of it.
fn equation_tooltips(
    chunks: &[FrameItemsChunk],
    overlays: &[EquationOverlay],
    eq_ranges: &[Range<usize>],
    focus: TooltipFocus,
    context: &SourceContext,
    world: &TypstWorld,
) -> Vec<FrameItemsChunk> {
    if eq_ranges.is_empty() || overlays.is_empty() {
        return Vec::new();
    }

    let Some(raw_source) = context.raw_source(world) else {
        return Vec::new();
    };

    let raw_lines = raw_source.lines();
    let source_len = raw_source.text().len();

    // Equation ranges sorted by start, so an overlay's tag span finds its
    // equation by binary search. Ranges are disjoint, so at most one contains
    // it.
    let mut bounds: Vec<(usize, usize)> = eq_ranges
        .iter()
        .map(|range| {
            (
                context.map_repaired_to_render(range.start, Side::After),
                context.map_repaired_to_render(range.end, Side::Before),
            )
        })
        .collect();
    bounds.sort_unstable_by_key(|(start, _)| *start);

    let equation_of = |range: &Range<usize>| {
        let candidate = bounds.partition_point(|(start, _)| *start <= range.start);
        let index = candidate.checked_sub(1)?;

        (range.end <= bounds[index].1).then_some(index)
    };

    // The equation the caller asked for, if the caret is inside one. The caret is
    // a raw offset and the bounds are render offsets, so it goes through the same
    // two maps the editor ranges take.
    let focused = focus.and_then(|caret| {
        let byte = raw_lines.utf16_to_byte(caret)?;
        let repaired = context.map_raw_to_repaired(byte, Side::Before);
        let render = context.map_repaired_to_render(repaired, Side::Before);

        equation_of(&(render..render))
    });

    if focus.is_some() && focused.is_none() {
        return Vec::new();
    }

    // Every item goes to the overlay it was laid out inside and to each of that
    // overlay's ancestors, so an overlay owns everything its own rendering drew.
    // One pass, and the nesting falls out of the walk. No equation is laid out
    // inside another today (an interpolated one reuses frames that were built
    // with no tag of their own), so the ancestor list is normally just the one
    // entry.
    let mut owned: Vec<Vec<BoundFrameItem>> = vec![Vec::new(); overlays.len()];

    for chunk in chunks {
        for item in &chunk.items {
            let mut current = item.equation;

            while let Some(index) = current {
                owned[index].push(item.clone());
                current = overlays[index].parent;
            }
        }
    }

    let mut tooltips = Vec::new();
    let mut taken: Vec<bool> = vec![false; bounds.len()];

    for (index, overlay) in overlays.iter().enumerate() {
        // An overlay whose equation is not in the synth's list has no source text
        // to anchor to. That happens for an equation written in the prelude.
        let Some(equation) = overlay.range.as_ref().and_then(equation_of) else {
            continue;
        };

        if focused.is_some_and(|focused| focused != equation) {
            continue;
        }

        // A binding used from several equations lays out one overlay per use and
        // they all report the definition's range. The editor wants one popup per
        // range, so the first use wins and the rest are dropped rather than
        // rendered as SVGs nothing will read.
        if std::mem::replace(&mut taken[equation], true) {
            continue;
        }

        let (start, end) = bounds[equation];

        if let Some(chunk) = tooltip_chunk(
            std::mem::take(&mut owned[index]),
            start,
            end,
            context,
            raw_lines,
            source_len,
        ) {
            tooltips.push(chunk);
        }
    }

    tooltips.sort_by_key(|chunk| chunk.range.start);

    tooltips
}

/// Sizes one equation's items into an overlay chunk, or `None` when it has
/// nothing to draw.
fn tooltip_chunk(
    items: Vec<BoundFrameItem>,
    start: usize,
    end: usize,
    context: &SourceContext,
    raw_lines: &typst_syntax::Lines<String>,
    source_len: usize,
) -> Option<FrameItemsChunk> {
    if items.is_empty() {
        return None;
    }

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

    // Empty content reports an infinite bounding box (Typst uses `Rect` at
    // +/-inf for "nothing here"). Chunks get filtered by the positivity check
    // in the partition loop, but tooltips need the same guard or the SVG
    // renderer asserts on a non-finite size.
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

    // The equation's own AST range, not a fold over its items. A `let`-bound
    // equation lays its items out at each use, so folding item ranges reports
    // one range spanning the definition and every use.
    //
    // The range is not padded. It used to be padded by a byte on each side
    // because the fold stopped at the first and last *item*, which sit inside
    // the `$` delimiters, so the editor missed a cursor resting on a delimiter.
    // An equation range already covers both delimiters, and padding it now makes
    // the popup reach one character into the prose on either side.
    let raw_start = context.map_render_to_raw(start);
    let raw_end = context.map_render_to_raw(end).min(source_len);

    // Both boundaries land on a `$`, so neither splits a character. The
    // fallback narrows the boundary rather than dropping the popup when one
    // does land mid-character.
    let raw_start_utf16 = raw_lines
        .byte_to_utf16(raw_start)
        .or_else(|| raw_lines.byte_to_utf16(raw_start.saturating_sub(1)))?;
    let raw_end_utf16 = raw_lines
        .byte_to_utf16(raw_end)
        .or_else(|| raw_lines.byte_to_utf16(raw_end.saturating_sub(1)))?;

    Some(FrameItemsChunk {
        items: VecDeque::from(items),
        range: raw_start_utf16..raw_end_utf16,
        width,
        height,
        x_offset: block_start_width,
        y_offset: block_start_height,
        // Tooltip chunks are overlays, not stacked content.
        list_item: false,
    })
}

/// Whether a frame item paints anything, and so has to stay inside its
/// chunk's crop. The synth wraps every block in a `#block(stroke: 0pt)`, and
/// tags are position markers. Neither draws, so they do not clamp the top.
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
