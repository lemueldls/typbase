//! Builds the searchable text and glyph boxes for one rendered frame.
//!
//! Runs are taken from the same `BoundFrameItem`s the SVG renderer consumes, so
//! their boxes stay in the frame's own coordinate space. Source ranges go
//! through the note's maps back to raw UTF-16, which is what the editor uses.

use std::collections::VecDeque;

use typst::layout::FrameItem;
use typst_syntax::{Source, Span};

use crate::{
    renderer::paged::BoundFrameItem,
    source::{FrameTextGlyph, FrameTextRun, SourceContext},
    world::TypstWorld,
};

/// Text runs for one frame, in paint order.
pub(super) fn frame_runs(
    items: &VecDeque<BoundFrameItem>,
    y_offset: f64,
    raw_source: &Source,
    context: &SourceContext,
    world: &TypstWorld,
) -> Vec<FrameTextRun> {
    let lines = raw_source.lines();
    let mut runs = Vec::new();

    for block in items {
        let FrameItem::Text(text) = &block.item else {
            continue;
        };

        if text.glyphs.is_empty() {
            continue;
        }

        let run_text = text.text.as_str();
        let utf16 = utf16_offsets(run_text);
        let origin_x = block.point.x.to_pt();
        let top = block.bounds.min.y.to_pt() - y_offset;
        let height = block.bounds.size().y.to_pt();

        if run_text.trim().is_empty()
            || !origin_x.is_finite()
            || !top.is_finite()
            || !height.is_finite()
        {
            continue;
        }

        // Node ranges say where the run's characters can live. The glyph spans
        // are per shaping segment, not per character, so the run text is
        // matched against the source in order to split it back into per-glyph
        // ranges.
        let node_ranges: Vec<Option<(usize, usize)>> = text
            .glyphs
            .iter()
            .map(|glyph| node_raw_range(glyph.span.0, context, world))
            .collect();
        let mut run_range: Option<(usize, usize)> = None;
        for range in node_ranges.iter().flatten() {
            run_range = Some(match run_range {
                Some((start, end)) => (start.min(range.0), end.max(range.1)),
                None => *range,
            });
        }
        let raw_text = raw_source.text();
        let mut cursor = run_range.map_or(0, |range| range.0);

        let mut x = origin_x;
        let mut glyphs = Vec::with_capacity(text.glyphs.len());

        for (index, glyph) in text.glyphs.iter().enumerate() {
            let range = glyph.range();
            let start = utf16.get(range.start).copied().unwrap_or(0);
            let end = utf16.get(range.end).copied().unwrap_or(start);
            let advance = glyph.x_advance.at(text.size).to_pt();
            let offset = glyph.x_offset.at(text.size).to_pt();

            let mapped = glyph_source_range(
                run_text.get(range.clone()).unwrap_or_default(),
                run_range,
                &mut cursor,
                raw_text,
            )
            .or(node_ranges[index]);
            let (from, to) = mapped.map_or((None, None), |(start, end)| {
                match (lines.byte_to_utf16(start), lines.byte_to_utf16(end)) {
                    (Some(from), Some(to)) => (Some(from), Some(to)),
                    _ => (None, None),
                }
            });

            glyphs.push(FrameTextGlyph {
                start,
                end,
                from,
                to,
                x: x + offset,
                width: advance,
            });

            x += advance;
        }

        runs.push(FrameTextRun {
            text: run_text.into(),
            x: origin_x,
            y: top,
            width: x - origin_x,
            height,
            glyphs: glyphs.into(),
        });
    }

    runs
}

/// UTF-16 offset of every byte boundary in `text`, plus an end sentinel.
///
/// A glyph range always lands on a character boundary, so interior byte
/// positions map to the start of their character.
fn utf16_offsets(text: &str) -> Vec<usize> {
    let mut out = vec![0; text.len() + 1];
    let mut units = 0;

    for (byte, ch) in text.char_indices() {
        out[byte] = units;
        units += ch.len_utf16();
    }

    out[text.len()] = units;
    out
}

/// Raw byte range of a glyph's source node, when the span belongs to this note.
///
/// Spans from embedded pages and query results point into their own files. The
/// page text still needs their glyphs, but there is no editor range to return.
fn node_raw_range(
    span: Span,
    context: &SourceContext,
    world: &TypstWorld,
) -> Option<(usize, usize)> {
    let id = span.id()?;
    let range = context.span_range(world, span)?;

    if id == context.render_id {
        Some((
            context.map_render_to_raw(range.start),
            context.map_render_to_raw(range.end),
        ))
    } else if id == context.synth_id {
        Some((
            context.map_synth_to_raw(range.start),
            context.map_synth_to_raw(range.end),
        ))
    } else {
        None
    }
}

/// Finds a glyph's text in the run's source range, moving `cursor` past it.
///
/// Markup between source characters is skipped naturally: the glyph text is
/// looked up in order. A glyph that does not appear in the source, such as a
/// shaped math symbol, falls back to its node range.
fn glyph_source_range(
    glyph_text: &str,
    run_range: Option<(usize, usize)>,
    cursor: &mut usize,
    raw_text: &str,
) -> Option<(usize, usize)> {
    let (_, end) = run_range?;
    if glyph_text.is_empty() || *cursor > end || *cursor > raw_text.len() {
        return None;
    }

    let found = raw_text.get(*cursor..end)?.find(glyph_text)?;
    let start = *cursor + found;
    *cursor = start + glyph_text.len();

    Some((start, *cursor))
}
