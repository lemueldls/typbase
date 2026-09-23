//! Error recovery for failed synth compiles.
//!
//! When a compile fails, the recovery pass identifies which part of the synth
//! is responsible, neutralizes it, and returns enough information for the
//! caller to retry. Two strategies are available, applied in order
//! of specificity:
//!
//! ## Block removal
//!
//! [`remove_errornous_block`] operates at the granularity of the blocks
//! produced by `sync_source_context`. It finds the block whose synth range
//! overlaps the diagnostic span and overwrites it with whitespace.
//!
//! Crucially, the replacement is exactly the same byte length as the block it
//! replaces. The [`SourceMap`](crate::source::SourceMap) records the region as
//! generated, so offsets do not move and later blocks stay mappable.
//!
//! ## Math marking
//!
//! [`try_mark_errornous`] operates at the granularity of individual math
//! expressions. It is tried first, before block removal, when the diagnostic
//! falls inside an equation range. Rather than blanking the broken expression,
//! it wraps it in a red-text marker so the rest of the equation keeps
//! rendering normally.
//!
//! Marks are applied right to left, so each edit leaves the ranges of the
//! expressions still to be marked valid. The map records each wrapper through
//! [`SourceMap::insert`](crate::source::SourceMap::insert); there is no manual
//! anchor bookkeeping.
//!
//! The wrapper puts the token back into a content block, where markup
//! characters (`_`, `$`, `*`, brackets, ...) are syntax again. Those bytes are
//! replaced with `?` first, same length, so a token like `_` cannot fail the
//! wrapper and spin recovery forever.
//!
//! ## Recovery loop
//!
//! The caller runs these passes in a bounded retry loop (see
//! `renderer/paged/items.rs` for the SVG case). The loop terminates when either
//! a compile succeeds or the divergence counter reaches its limit, preventing
//! infinite loops on documents that genuinely cannot be fixed by blanking.

use std::ops::Range;

use ecow::EcoVec;
use rustc_hash::FxHashSet;
use typst::diag::{Severity, SourceDiagnostic};

use crate::{
    bindings::map_synth_span,
    source::{SegmentKind, Side, SourceContext, SynthBlock},
    world::TypstWorld,
};

/// Removes the block containing the first error from the source, updating
/// diagnostics and context.
///
/// Returns the indices of the removed blocks, or an empty vector if no error
/// blocks were found.
#[typst_macros::time]
pub fn remove_errornous_block(
    blocks: &[SynthBlock],
    source_diagnostics: &EcoVec<SourceDiagnostic>,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> Vec<usize> {
    let error_ranges = source_diagnostics
        .iter()
        .filter_map(|diagnostic| {
            map_synth_span(
                diagnostic.span,
                diagnostic.severity == Severity::Error,
                &diagnostic.trace,
                context,
                world,
            )
        })
        .collect::<FxHashSet<_>>();

    let (indicies, render_ranges): (Vec<usize>, Vec<Range<usize>>) = blocks
        .iter()
        .enumerate()
        .filter_map(|(idx, block)| {
            let repaired_range = &block.range;

            // Outer range: include the generated wrapper and separator so the
            // whole block disappears, not just its content.
            let render_start = context.map_repaired_to_render(repaired_range.start, Side::Before);
            let render_end = context.map_repaired_to_render(repaired_range.end, Side::After);
            let render_range = render_start..render_end;

            let in_block = error_ranges.iter().any(|error_range| {
                (render_start <= error_range.start && render_end >= error_range.start)
                    || (render_start <= error_range.end && render_end >= error_range.end)
            });

            in_block.then_some((idx, render_range))
        })
        .unzip();

    for render_range in render_ranges {
        // Fill the block with whitespace to stabilize ranges.
        let length = render_range.len();
        let whitespace = " ".repeat(length.saturating_sub(1)) + "\n";
        let source = context.render_source_mut(world).unwrap();
        source.edit(render_range.clone(), &whitespace);
        context
            .render_map
            .replace(render_range, &whitespace, SegmentKind::ErrorMark);
    }

    indicies
}

/// Tries to mark the specific expressions containing errors and wraps them in
/// a red text expression for visual feedback in the rendered output.
///
/// If marking is unsuccessful (e.g., due to complex expressions or multiple
/// errors), it falls back to removing the entire block containing the error, as
/// implemented in [`remove_errornous_block`].
#[typst_macros::time]
pub fn try_mark_errornous(
    source_diagnostics: &EcoVec<SourceDiagnostic>,
    eq_ranges: &[Range<usize>],
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> MarkedErrors {
    let pre_text = "#math.italic(text(fill:theme.danger)[";
    let post_text = "])";
    let pre_text_len = pre_text.len();
    let post_text_len = post_text.len();
    let total_wrap_len = pre_text_len + post_text_len;

    if eq_ranges.is_empty() {
        return MarkedErrors {
            marks: Vec::new(),
            pre_text_len,
            post_text_len,
            total_wrap_len,
        };
    }

    let eq_ranges = eq_ranges
        .iter()
        .map(|eq_range| {
            context.map_repaired_to_render(eq_range.start, Side::After)
                ..context.map_repaired_to_render(eq_range.end, Side::Before)
        })
        .collect::<Vec<_>>();

    let mut error_ranges = source_diagnostics
        .iter()
        .filter_map(|diagnostic| {
            map_synth_span(
                diagnostic.span,
                diagnostic.severity == Severity::Error,
                &diagnostic.trace,
                context,
                world,
            )
        })
        .filter(|range| {
            #[allow(clippy::suspicious_operation_groupings)]
            eq_ranges.iter().any(|eq_range| {
                (range.start >= eq_range.start && range.start <= eq_range.end)
                    || (range.end >= eq_range.start && range.end <= eq_range.end)
            })
        })
        .collect::<Vec<_>>();

    // Merge overlapping diagnostics so nested errors get one wrapper.
    error_ranges.sort_by_key(|range| (range.start, range.end));

    let mut merged: Vec<Range<usize>> = Vec::new();
    for range in error_ranges {
        if let Some(last) = merged.last_mut()
            && range.start <= last.end
        {
            last.end = last.end.max(range.end);
        } else {
            merged.push(range);
        }
    }

    // Apply marks right to left: an edit never moves the ranges of the
    // expressions still to be processed.
    let mut pending: Vec<PendingMark> = Vec::new();
    let mut boundary = usize::MAX;

    for range in merged.into_iter().rev() {
        let source = context.render_source_mut(world).unwrap();
        let mut synth_range = expand_math_call(source.text(), range);
        synth_range.end = synth_range.end.min(boundary);

        if synth_range.is_empty() {
            continue;
        }

        // `#undefined` in math is a code expression; the diagnostic span
        // covers the name, not the `#`. Replacing the `#` with the wrapper
        // turns the name into literal red text. Leaving the `#` outside would
        // put it in front of the inserted code and fail the same way again.
        let hash_len = usize::from(
            synth_range.start > 0 && source.text().as_bytes()[synth_range.start - 1] == b'#',
        );
        let pre_offset = synth_range.start - hash_len;
        let post_offset = synth_range.end + pre_text_len - hash_len;

        let original_text = source.text()[synth_range.clone()].to_string();
        let raw_range =
            context.render_map.backward(pre_offset)..context.render_map.backward(synth_range.end);
        context.marked_raw_ranges.push(raw_range.clone());

        // The wrapper puts the token inside a content block, where markup
        // characters like `_` or `$` are syntax again and would fail the same
        // compile. Swap them for a same-byte placeholder so the mark renders
        // instead of spinning recovery; record it as generated or the map
        // still claims the old bytes.
        let marked_text = sanitize_marked_text(&original_text);
        if marked_text != original_text {
            let source = context.render_source_mut(world).unwrap();
            source.edit(synth_range.clone(), &marked_text);
            context
                .render_map
                .replace(synth_range.clone(), &marked_text, SegmentKind::ErrorMark);
        }

        let source = context.render_source_mut(world).unwrap();
        if hash_len == 0 {
            source.edit(pre_offset..pre_offset, pre_text);
        } else {
            source.edit(pre_offset..pre_offset + hash_len, pre_text);
        }
        source.edit(post_offset..post_offset, post_text);

        if hash_len == 0 {
            context
                .render_map
                .insert(pre_offset, pre_text, SegmentKind::ErrorMark);
        } else {
            context.render_map.replace(
                pre_offset..pre_offset + hash_len,
                pre_text,
                SegmentKind::ErrorMark,
            );
        }
        context
            .render_map
            .insert(post_offset, post_text, SegmentKind::ErrorMark);

        boundary = pre_offset;
        pending.push(PendingMark {
            original: synth_range,
            hash_len,
            text: original_text,
            raw_range,
        });
    }

    // Translate the pre-edit ranges to final coordinates. `pending` is in
    // reverse order; sorting ascending makes every earlier mark entirely to
    // the left, so each contributes its own wrapper length of shift.
    pending.sort_by_key(|mark| mark.original.start);

    let mut shift = 0;
    let marks = pending
        .into_iter()
        .map(|mark| {
            let wrap_len = total_wrap_len - mark.hash_len;
            let marked =
                mark.original.start - mark.hash_len + shift..mark.original.end + shift + wrap_len;
            shift += wrap_len;
            ErrorMark {
                text: mark.text,
                synth_range: marked,
                raw_range: mark.raw_range,
            }
        })
        .collect();

    MarkedErrors {
        marks,
        pre_text_len,
        post_text_len,
        total_wrap_len,
    }
}

/// One mark between the pre-edit range and the final coordinates.
struct PendingMark {
    original: Range<usize>,
    /// 1 when the mark replaced a `#` instead of inserting before the range.
    hash_len: usize,
    text: String,
    raw_range: Range<usize>,
}

/// Characters that mean syntax again once the marked token sits inside the
/// wrapper's content block. Replaced with `?` so the mark compiles.
const UNSAFE_IN_CONTENT: &[u8] = b"#$_*`~<>@\\[]";

/// Makes a marked token safe to embed as literal content, byte-for-byte. Only
/// ASCII markup characters change, so UTF-8 text keeps its length and the
/// caller's range bookkeeping stays valid.
fn sanitize_marked_text(text: &str) -> String {
    if !text.bytes().any(|byte| UNSAFE_IN_CONTENT.contains(&byte)) {
        return text.to_owned();
    }

    text.chars()
        .map(|ch| {
            if ch.is_ascii() && UNSAFE_IN_CONTENT.contains(&(ch as u8)) {
                '?'
            } else {
                ch
            }
        })
        .collect()
}

/// Expands a marked range over a math call's argument list.
///
/// An unknown variable used as a math callee (`notdefined(x)`) reports its
/// span on the callee alone. Wrapping just the callee leaves `(x)` to attach
/// to the inserted code expression, which fails again and spins the recovery
/// loop. Marking the whole call as red content renders instead.
fn expand_math_call(text: &str, range: Range<usize>) -> Range<usize> {    let bytes = text.as_bytes();

    if bytes.get(range.end) != Some(&b'(') {
        return range;
    }

    let mut depth = 0_usize;
    let mut index = range.end;

    while index < bytes.len() {
        match bytes[index] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return range.start..index + 1;
                }
            }
            _ => {}
        }

        index += 1;
    }

    range
}

#[derive(Debug)]
pub struct MarkedErrors {
    pub marks: Vec<ErrorMark>,
    pub pre_text_len: usize,
    pub post_text_len: usize,
    pub total_wrap_len: usize,
}

#[derive(Debug)]
pub struct ErrorMark {
    pub text: String,
    /// The marked span in final render coordinates, wrapper included.
    pub synth_range: Range<usize>,
    /// Raw range of the marked expression, captured before the wrapper was
    /// inserted.
    pub raw_range: Range<usize>,
}
