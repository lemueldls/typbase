//! Error recovery for failed synth compiles.
//!
//! When a compile fails, the recovery pass identifies which part of the synth
//! is responsible, neutralizes it, and returns enough information for the
//! caller to retry. Three strategies are available, applied in order of
//! specificity:
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
//! ## Unmappable errors
//!
//! Package code that errors after `context` deferral (a plugin call inside
//! `layout`, say) reports a span and trace that all sit in the package file.
//! No diagnostic maps to a block, so block removal and math marking have
//! nothing to work with. [`remove_unmappable_block`] bisects the block list
//! instead: it compiles prefixes with the suffix blanked and blanks the first
//! block whose prefix fails with an unmappable error. Every probe restores the
//! render source and map, so the search leaves the caller's state alone.
//!
//! ## Recovery loop
//!
//! The caller runs these passes in a bounded retry loop (see
//! `renderer/paged/items.rs` for the SVG case). The loop terminates when either
//! a compile succeeds or the divergence counter reaches its limit, preventing
//! infinite loops on documents that cannot be fixed by blanking.

use std::ops::Range;

use ecow::EcoVec;
use rustc_hash::FxHashSet;
use typst::{
    compile,
    diag::{Severity, SourceDiagnostic},
    foundations::Output,
    syntax::{LinkedNode, ast::FuncCall},
};

use crate::{
    bindings::map_synth_span,
    source::{SegmentKind, Side, SourceContext, SynthBlock},
    world::TypstWorld,
};

/// Probe compiles one render may spend on [`remove_unmappable_block`] before
/// giving up. Each probe is a full compile of a prefixed source, so a page
/// with many unmappable errors must not turn recovery into a compile storm.
pub const PROBE_BUDGET: u32 = 32;

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
        blank_render_range(render_range, context, world);
    }

    indicies
}

/// Fills a render range with whitespace of the same length, recording the
/// replacement in the map. Ranges do not move, so later blocks stay mappable.
///
/// Empty ranges are skipped: writing `"\n"` into them would insert a byte and
/// shift every offset after it.
fn blank_render_range(
    render_range: Range<usize>,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> bool {
    if render_range.is_empty() {
        return false;
    }

    let length = render_range.len();
    let whitespace = " ".repeat(length.saturating_sub(1)) + "\n";
    let Some(source) = context.render_source_mut(world) else {
        return false;
    };
    source.edit(render_range.clone(), &whitespace);
    context
        .render_map
        .replace(render_range, &whitespace, SegmentKind::ErrorMark);

    true
}

/// [`blank_render_range`] for one synth block, mapping the block's repaired
/// range to the render source first.
fn blank_block(block: &SynthBlock, context: &mut SourceContext, world: &mut TypstWorld) -> bool {
    let render_range = context.map_repaired_to_render(block.range.start, Side::Before)
        ..context.map_repaired_to_render(block.range.end, Side::After);

    blank_render_range(render_range, context, world)
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

/// Splits a failed pass into diagnostics that map to a user range and ones
/// that do not.
///
/// Unowned warnings land in the first list and are dropped downstream by
/// [`crate::bindings::TypstDiagnostic::from_diagnostics`], matching its
/// behavior.
pub fn split_unmappable(
    diagnostics: &[SourceDiagnostic],
    context: &SourceContext,
    world: &TypstWorld,
) -> (EcoVec<SourceDiagnostic>, Vec<SourceDiagnostic>) {
    let mut mapped = Vec::new();
    let mut unmappable = Vec::new();

    for diagnostic in diagnostics {
        if is_unmappable(diagnostic, context, world) {
            unmappable.push(diagnostic.clone());
        } else {
            mapped.push(diagnostic.clone());
        }
    }

    (mapped.into_iter().collect(), unmappable)
}

/// Whether a diagnostic's span and trace all point outside the note's own
/// sources, so no block can be selected from it.
fn is_unmappable(
    diagnostic: &SourceDiagnostic,
    context: &SourceContext,
    world: &TypstWorld,
) -> bool {
    diagnostic.severity == Severity::Error
        && map_synth_span(diagnostic.span, true, &diagnostic.trace, context, world).is_none()
}

fn unmappable_errors(
    diagnostics: &[SourceDiagnostic],
    context: &SourceContext,
    world: &TypstWorld,
) -> Vec<SourceDiagnostic> {
    diagnostics
        .iter()
        .filter(|diagnostic| is_unmappable(diagnostic, context, world))
        .cloned()
        .collect()
}

/// What one prefix probe found.
enum Probe {
    /// The prefix compiles.
    Compiles,
    /// The prefix fails, but every error maps to a user range.
    Mapped,
    /// The prefix fails with at least one error that maps nowhere.
    Unmappable(Vec<SourceDiagnostic>),
}

/// Compiles `blocks[prefix..]` blanked and restores the render source and map
/// afterwards, so a probe never leaks into the caller's state.
fn probe_prefix<T: Output>(
    blocks: &[SynthBlock],
    prefix: usize,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> Probe {
    let Some(text) = context
        .render_source(world)
        .map(|source| source.text().to_string())
    else {
        return Probe::Compiles;
    };
    let map = context.render_map.clone();

    for block in &blocks[prefix..] {
        blank_block(block, context, world);
    }

    let probe = match compile::<T>(world).output {
        Ok(..) => Probe::Compiles,
        Err(diagnostics) => {
            let unmappable = unmappable_errors(&diagnostics, context, world);

            if unmappable.is_empty() {
                Probe::Mapped
            } else {
                Probe::Unmappable(unmappable)
            }
        }
    };

    if let Some(source) = context.render_source_mut(world) {
        source.replace(&text);
    }
    context.render_map = map;

    probe
}

/// Blanks the first block whose prefix fails with an error that maps to no
/// user span, and returns that block's index plus the prefix's unmappable
/// errors.
///
/// `diagnostics` is the failing compile of the full render source. `None`
/// means no block can be blamed: blanking every block still fails (a prelude
/// error, say) or the probe budget ran out. The caller then gives up on the
/// note as before.
pub fn remove_unmappable_block<T: Output>(
    blocks: &[SynthBlock],
    diagnostics: &[SourceDiagnostic],
    context: &mut SourceContext,
    world: &mut TypstWorld,
    budget: &mut u32,
) -> Option<(usize, Vec<SourceDiagnostic>)> {
    if blocks.is_empty() {
        return None;
    }

    let mut hi_errors = unmappable_errors(diagnostics, context, world);
    if hi_errors.is_empty() {
        return None;
    }

    // A document with every block blanked must compile, or no set of blocks
    // can fix it. This also rules out prelude failures.
    if *budget == 0 {
        return None;
    }
    *budget -= 1;
    if let Probe::Unmappable(..) = probe_prefix::<T>(blocks, 0, context, world) {
        return None;
    }

    // Smallest prefix that fails with an unmappable error. The predicate is
    // monotone: an unmappable error raised by one block is not fixed by adding
    // later blocks.
    let mut lo = 0_usize;
    let mut hi = blocks.len();

    while hi - lo > 1 {
        if *budget == 0 {
            return None;
        }
        *budget -= 1;

        let mid = lo + (hi - lo) / 2;
        match probe_prefix::<T>(blocks, mid, context, world) {
            Probe::Unmappable(errors) => {
                hi = mid;
                hi_errors = errors;
            }
            Probe::Compiles | Probe::Mapped => lo = mid,
        }
    }

    // The block that introduced the failure is the last one in the prefix.
    let index = hi - 1;
    blank_block(&blocks[index], context, world);

    Some((index, hi_errors))
}

/// The raw range the editor should blame for a block that failed with no user
/// span.
///
/// Narrows to the block's only call expression when it has exactly one, so
/// `#render("digraph { a -> }")` underlines the call instead of the whole
/// paragraph. Multi-call blocks stay at block granularity; guessing which call
/// reached the failing package would point at the wrong line.
pub fn blamed_raw_range(
    block: &SynthBlock,
    context: &SourceContext,
    world: &TypstWorld,
) -> Range<usize> {
    let start = context.map_repaired_to_raw(block.range.start);
    let end = context.map_repaired_to_raw(block.range.end);

    let narrowed = context
        .raw_source(world)
        .and_then(|source| source.text().get(start..end))
        .and_then(single_call_range);

    match narrowed {
        Some(call) => start + call.start..start + call.end,
        None => start..end,
    }
}

/// The range of a text's only function call, `#` included, if it has exactly
/// one.
fn single_call_range(text: &str) -> Option<Range<usize>> {
    let root = typst::syntax::parse(text);
    let mut stack = vec![LinkedNode::new(&root)];
    let mut calls = Vec::new();

    while let Some(node) = stack.pop() {
        if node.get().cast::<FuncCall>().is_some() {
            calls.push(node.range());
        }

        for child in node.children() {
            stack.push(child);
        }
    }

    if calls.len() != 1 {
        return None;
    }

    let mut range = calls.pop()?;

    // The `#` marker before a code expression is a sibling, not part of the
    // call node. Include it so the squiggle starts at the hash.
    if range.start > 0 && text.as_bytes().get(range.start - 1) == Some(&b'#') {
        range.start -= 1;
    }

    Some(range)
}
