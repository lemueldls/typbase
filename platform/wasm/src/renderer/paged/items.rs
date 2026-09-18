use std::{cmp, collections::VecDeque, ops::Range};

use typst::{compile, layout::FrameItem};
use typst_layout::PagedDocument;

use super::frame::{BoundFrameSink, bound_frame};
use crate::{
    bindings::{TypstDiagnostic, TypstFileId},
    renderer::{
        paged::{BoundFrameItem, FrameItemsChunk, PagedRender},
        recovery::{map_error_mark_index, remove_errornous_block, try_mark_errornous},
    },
    source::{
        RenderTarget, SourceContext, SynthBlock, SynthResult, delimiter_diagnostics,
        sync_source_context,
    },
    state::TypstState,
    world::TypstWorld,
};

/// Chunks a Typst document into renderable blocks by frame items, handling
/// diagnostics and error divergence.
///
/// The compile runs against the disposable render source, so recovery can
/// rewrite it without touching the pristine synth. IDE queries parse the
/// render source too (see `TypstState::hover`), which is why recovery must
/// keep it compilable: blocks get blanked, math spans get placeholders.
#[typst_macros::time]
pub fn chunk_by_items(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    render_target: RenderTarget,
    state: &mut TypstState,
) -> PagedRender {
    let prelude = state.prelude(id, render_target) + prelude + "\n";
    let context = state.source_context_map.get_mut(id).unwrap();
    let SynthResult {
        mut blocks,
        equation_ranges,
        ..
    } = sync_source_context(text, prelude, context, &mut state.world);

    // Compile the render source for the rest of this call. The pristine synth
    // stays in the world for hover/autocomplete/jump.
    state.world.main_id = Some(context.render_id);

    let mut divergence = 0_u8;

    let mut render = chunk_by_items_with_blocks(
        &mut blocks,
        &equation_ranges,
        &mut divergence,
        context,
        &mut state.world,
    );

    state.world.main_id = Some(context.synth_id);

    // The repaired document compiles cleanly, so the unclosed-delimiter
    // warnings have to come from the fixup list, not the compiler.
    let mut diagnostics = delimiter_diagnostics(&context.render_fixups, text);
    diagnostics.append(&mut render.diagnostics);
    render.diagnostics = diagnostics;

    render
}

#[allow(clippy::iter_with_drain)]
#[typst_macros::time]
pub fn chunk_by_items_with_blocks(
    blocks: &mut Vec<SynthBlock>,
    eq_ranges: &Vec<Range<usize>>,
    divergence: &mut u8,
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

                let mut chunks = Vec::with_capacity(blocks.len());
                let mut remaining_items = Vec::<BoundFrameItem>::new();

                for block in blocks.iter() {
                    let Some(raw_source) = context.raw_source(world) else {
                        continue;
                    };

                    // Block ranges are in repaired-source coordinates. The
                    // editor range must be raw: an inserted closer maps back
                    // to the offset it was inserted at.
                    let repaired_range = &block.range;
                    let raw_range = context.map_repaired_to_raw_from_left(repaired_range.start)
                        ..context.map_repaired_to_raw_from_right(repaired_range.end);

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
                        context.map_repaired_to_render_from_right(repaired_range.end);

                    let mut chunk_items = VecDeque::<BoundFrameItem>::new();
                    let mut deferred_items = Vec::<BoundFrameItem>::new();

                    let mut block_start_width = None;
                    let mut block_start_height = None;
                    let mut block_end_width = None;
                    let mut block_end_height = None;

                    // Grow the block's bounding box with each item it keeps.
                    let mut absorb = |block: &BoundFrameItem| {
                        match block_start_width {
                            Some(width) if width < block.bounds.min.x => {}
                            _ => block_start_width = Some(block.bounds.min.x),
                        }

                        match block_start_height {
                            Some(height) if height < block.bounds.min.y => {}
                            _ => block_start_height = Some(block.bounds.min.y),
                        }

                        match block_end_width {
                            Some(width) if width > block.bounds.max.x => {}
                            _ => block_end_width = Some(block.bounds.max.x),
                        }

                        match block_end_height {
                            Some(height) if height > block.bounds.max.y => {}
                            _ => block_end_height = Some(block.bounds.max.y),
                        }
                    };

                    while let Some(frame_block) = bound_frame_items.peek() {
                        if let Some(range) = &frame_block.range {
                            if range.end <= synth_range_end {
                                let frame_block = bound_frame_items.next().unwrap();

                                // crate::log!("{frame_block:#?}");

                                absorb(&frame_block);

                                for deferred in deferred_items.drain(..) {
                                    absorb(&deferred);
                                    chunk_items.push_back(deferred);
                                }
                                chunk_items.push_back(frame_block);
                            } else {
                                break;
                            }
                        } else {
                            let frame_block = bound_frame_items.next().unwrap();
                            deferred_items.push(frame_block);
                        }
                    }

                    // Items whose range belongs to another file (e.g. an
                    // `#typbase.embed` include) never match this block's
                    // range, so a block that renders nothing of its own would
                    // drop them all and the embedded page vanished. Give them
                    // a chunk mapped to the include line instead.
                    if chunk_items.is_empty() && !deferred_items.is_empty() {
                        for deferred in deferred_items.drain(..) {
                            absorb(&deferred);
                            chunk_items.push_back(deferred);
                        }
                    }

                    let block_start_width = block_start_width.unwrap_or_default().to_pt();
                    let block_start_height = block_start_height.unwrap_or_default().to_pt();
                    let block_end_width = block_end_width.unwrap_or_default().to_pt();
                    let block_end_height = block_end_height.unwrap_or_default().to_pt();

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

                    chunks.push(FrameItemsChunk {
                        items: chunk_items,
                        range: raw_range_utf16,
                        width: block_width,
                        height: block_height,
                        x_offset: block_start_width,
                        y_offset: block_start_height,
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
                    map_error_mark_index(&marked_errors, context);

                    let marked_render =
                        chunk_by_items_with_blocks(blocks, eq_ranges, divergence, context, world);

                    let render_source = context.render_source_mut(world).unwrap();

                    for mark in &marked_errors.marks {
                        let start_byte = mark.synth_range.start;
                        let end_byte = mark.synth_range.end;

                        // Replace the marked span with an equal-length
                        // placeholder. Positions stay put, so the document
                        // this produces can back hover/jump while the marked
                        // chunks above keep the red markers.
                        let byte_length = end_byte - start_byte;
                        let placeholder = format!("{:>byte_length$}", "\"\"");
                        render_source.edit(start_byte..end_byte, &placeholder);
                    }

                    let stable_render =
                        chunk_by_items_with_blocks(blocks, eq_ranges, divergence, context, world);

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

            let raw_start = context.map_render_to_raw_from_left(synth_range.start);
            let raw_end = context.map_render_to_raw_from_right(synth_range.end);

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
