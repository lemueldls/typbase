use std::ops::Range;

use typst_syntax::{LinkedNode, Source, SyntaxKind};

use crate::{
    bindings::TypstFileId,
    source::{
        DelimiterFix, RawFixups, SegmentKind, SourceBuilder, SourceContext, SourceMap, delimiters,
    },
    state::TypstState,
    world::TypstWorld,
};

use super::context::SyncedInput;

/// The result of a synth-building pass.
pub struct SynthResult {
    /// The top-level blocks discovered in the (repaired) raw source, in source
    /// order. Each block's `range` is in repaired-source bytes.
    pub blocks: Vec<SynthBlock>,

    /// Repaired-source ranges of every `equation` node, at any depth, used by
    /// the math error recovery pass to scope finer-grained fixes and by the
    /// paged partition to group an equation's frame items into a tooltip.
    pub equation_ranges: Vec<Range<usize>>,

    /// Closing delimiters the raw source was missing, as found by
    /// [`delimiters::find_fixes`].
    pub delimiter_fixes: Vec<DelimiterFix>,
}

/// A top-level node or contiguous run of nodes from the raw source,
/// corresponding to one independently renderable chunk.
#[derive(Debug, Clone)]
pub struct SynthBlock {
    /// Byte range in the **repaired** source. This is the range the rendered
    /// chunk maps back to in the editor.
    pub range: Range<usize>,

    /// True if this block contains inline content (list items, labels,
    /// or nodes that share a line with their neighbours). Inline blocks
    /// are not wrapped in `#block(...)`.
    pub inline: bool,

    /// True for a list, enum, or term item. Typst lays out the `spacing`
    /// between these items outside the item's ink, so neither item's chunk
    /// bounds contain it. The partition hands the gap to the upper item's
    /// chunk, which is what makes `list(spacing:)` visible in the editor.
    /// The space below the last item stays out of its chunk.
    pub list_item: bool,

    /// True for a block whose content is a math equation. The editor's line
    /// box does not apply to these: the equation's own box is the crop, and
    /// extending it would change math spacing.
    pub math: bool,
}

/// Output target for rendering.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum RenderTarget {
    /// Render as SVG.
    Svg,
    /// Render as PDF.
    Pdf,
    /// Render as HTML.
    Html,
}

#[typst_macros::time]
pub fn sync_source_state(
    id: &TypstFileId,
    text: &str,
    prelude: &str,
    render_target: RenderTarget,
    state: &mut TypstState,
) -> SynthResult {
    let prelude = state.prelude(id, render_target) + prelude + "\n";
    let context = state.source_context_map.get_mut(id).unwrap();

    sync_source_context(text, prelude, context, &mut state.world)
}

/// Builds all source files for a note and updates its maps.
///
/// Three texts are involved:
///
/// - The **raw** text, exactly what the user typed. All editor positions are
///   in raw coordinates.
/// - The **pristine synth** (`context.synth_id`), built from the raw text. It
///   is never mutated after this call. [`SourceMap`] describes it, and
///   diagnostics-only compiles read it.
/// - The **render synth** (`context.render_id`), built from the *repaired*
///   raw text (missing `$` and quotes closed). Error recovery rewrites ranges
///   of it. The pristine file stays untouched.
///
/// When no repair is needed the render synth is byte-identical to the
/// pristine one and the two maps match.
#[typst_macros::time]
pub fn sync_source_context(
    text: &str,
    prelude: String,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> SynthResult {
    // A compile with the same raw text and prelude rebuilds nothing. Restore
    // the pristine sources and map that recovery may have rewritten, then
    // hand back the cached structure. The prelude carries the pane width,
    // theme, fonts, and text size, so every setting change is a miss.
    //
    // The check reads the cached input text, not the world's raw source: the
    // editor's syntax-highlight field rewrites that source on every keystroke,
    // before the compile microtask runs, so it always looks unchanged.
    if let Some(last) = &context.last_sync
        && last.raw == text
        && last.prelude == prelude
    {
        world.insert_source_object(context.synth_id, last.synth_source.clone());
        world.insert_source_object(context.ide_id, last.synth_source.clone());
        world.insert_source_object(context.render_id, last.render_source.clone());
        context.render_map = last.render_map.clone();
        context.marked_raw_ranges.clear();
        world.main_id = Some(context.synth_id);

        return SynthResult {
            blocks: last.blocks.clone(),
            equation_ranges: last.equation_ranges.clone(),
            delimiter_fixes: context.render_fixups.fixes().to_vec(),
        };
    }

    // The repair pass parses the raw text, so both synths below can read that
    // tree: the pristine one because it is the raw text, the render one because
    // `repaired` equals the raw text whenever nothing needed closing. Only a
    // note that actually needed a repair parses a second time, for the text the
    // repair produced.
    let fixups = RawFixups::new(
        delimiters::find_fixes_in(&context.parse_cached(text), text),
        text.len(),
    );
    let repaired = fixups.repaired(text);

    let pristine = if fixups.is_empty() {
        None
    } else {
        Some(build_synth_in(&context.parse_cached(text), text, &prelude))
    };

    let render = build_synth_in(&context.parse_cached(&repaired), &repaired, &prelude);

    context.raw_source_mut(world).unwrap().replace(text);

    let (pristine_synth, index_map) = match pristine {
        Some(pristine) => (pristine.synth, pristine.map),
        None => (render.synth.clone(), render.map.clone()),
    };

    // Clone the prepared `Source` instead of the text: the text is refcounted
    // inside it, so the IDE and synth ids share one allocation.
    let synth_source = Source::new(context.synth_id, pristine_synth);
    world.insert_source_object(context.ide_id, synth_source.clone());
    world.insert_source_object(context.synth_id, synth_source.clone());

    let render_source = Source::new(context.render_id, render.synth);
    world.insert_source_object(context.render_id, render_source.clone());

    context.index_map = index_map;
    context.render_map = render.map.clone();
    context.render_fixups = fixups;
    context.marked_raw_ranges.clear();

    context.last_sync = Some(SyncedInput {
        raw: text.to_string(),
        prelude,
        blocks: render.blocks.clone(),
        equation_ranges: render.equation_ranges.clone(),
        render_map: render.map,
        synth_source,
        render_source,
    });

    world.main_id = Some(context.synth_id);

    SynthResult {
        blocks: render.blocks,
        equation_ranges: render.equation_ranges,
        delimiter_fixes: context.render_fixups.fixes().to_vec(),
    }
}

/// What one synth-building pass produced.
struct SynthBuild {
    synth: String,
    blocks: Vec<SynthBlock>,
    equation_ranges: Vec<Range<usize>>,
    map: SourceMap,
}

/// Builds a synth from a plain text source.
///
/// Walks the text's top-level syntax nodes and produces an intermediate
/// source string that:
///
/// 1. Begins with the generated prelude (page geometry, color theme, text
///    defaults).
/// 2. Wraps each run of content-producing nodes in `#block(...)`. Purely
///    structural nodes (`let`, `set`, `show`, imports, comments) are passed
///    through unmodified.
/// 3. Records a [`SourceMap`] segment at every copy and insertion, so offsets
///    translate between the two texts exactly.
///
/// Blank lines between blocks are not copied and add no generated spacing.
/// The wrappers give every top-level block the same `above`/`below` spacing,
/// so a compiled gap does not change with the block's contents.
///
/// ## Block wrapping
///
/// The wrapping turns a paragraph like:
///
/// ```typst
/// Hello, *world*.
/// ```
///
/// into:
///
/// ```typst
/// #block(stroke: 0pt, width: 100%)[
/// Hello, *world*.
/// ]
/// ```
///
/// This is what allows the renderer to later isolate each paragraph's layout
/// contribution from a single compiled document, without recompiling once
/// per paragraph.
///
/// List items, enum items, term items, and labels are copied unwrapped rather
/// than block-wrapped, because boxing them changes how they sit relative to
/// their siblings. The three item kinds also own the compiled spacing down to
/// the next item (see `SynthBlock::list_item`).
///
/// ## Inline items
///
/// A sequence of nodes with no newline between them (e.g. an inline equation in
/// the middle of a sentence) is collected into a single block. The
/// `SynthBlock::inline` flag is set on any block containing a node from the
/// inline category.
#[typst_macros::time]
/// Builds the synth from an already-parsed tree of `text`.
fn build_synth_in(root: &typst_syntax::SyntaxNode, text: &str, prelude: &str) -> SynthBuild {
    let mut builder = SourceBuilder::new(text);
    builder.prefix(prelude);

    let linked = LinkedNode::new(root);

    let equation_ranges = deep_equation_ranges(text, &linked);

    let mut blocks = Vec::<SynthBlock>::new();
    let mut in_block = false;

    let mut last_kind: Option<SyntaxKind> = None;

    // End of the last top-level node accepted, used to drop parser error
    // artifacts that point back into text already emitted.
    let mut accepted_end = 0;

    for node in linked.children() {
        let range = node.range();

        if range.start < accepted_end {
            continue;
        }

        accepted_end = accepted_end.max(range.end);

        let leaf = node.get().leaf_text();

        if let Some(until_newline) = leaf.chars().position(|ch| ch == '\n') {
            if in_block {
                // This leaf ends the open block at its first newline.
                in_block = false;

                if let Some(last_block) = blocks.last_mut() {
                    last_block.range.end = (last_block.range.end + until_newline).min(range.end);
                    wrap_block(&mut builder, last_block, last_kind);
                }
            } else if !leaf.trim().is_empty() {
                // A newline-bearing leaf outside a block is content of its
                // own. The parser folds an unclosed raw block or comment into
                // one error leaf whose text still contains newlines. Closing
                // the previous block again here wrapped it twice and produced
                // an out-of-order map.
                last_kind = Some(node.kind());
                in_block = true;

                blocks.push(SynthBlock {
                    range,
                    inline: false,
                    list_item: false,
                    math: false,
                });
            }
        } else {
            last_kind = Some(node.kind());

            if in_block {
                let last_block = blocks.last_mut().unwrap();
                last_block.range.end = last_block.range.end.max(range.end);
            } else {
                in_block = true;

                blocks.push(SynthBlock {
                    range,
                    inline: false,
                    list_item: false,
                    math: false,
                });
            }
        }
    }

    if let Some(last_block) = blocks.last_mut()
        && in_block
    {
        wrap_block(&mut builder, last_block, last_kind);
    }

    let (synth, map) = builder.finish();

    SynthBuild {
        synth,
        blocks,
        equation_ranges,
        map,
    }
}

/// Byte ranges of every equation in the tree, `$` delimiters included.
///
/// The walk descends through markup, code, and content blocks, so an equation
/// inside a list item, heading, term item, table cell, or `#box[...]` is found.
/// Only top-level children are walked in [`build_synth_in`], which is what the
/// block loop needs, and that misses all of those.
///
/// An equation nested inside another one (only reachable through a code
/// expression) is not recorded separately: the outer range already covers it,
/// and the error-recovery filter treats a diagnostic inside either as a math
/// error.
///
/// A document with no `$` cannot hold an equation, and the byte scan is three
/// orders of magnitude cheaper than the walk it skips.
fn deep_equation_ranges(text: &str, root: &LinkedNode) -> Vec<Range<usize>> {
    if !text.as_bytes().contains(&b'$') {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut stack = vec![root.clone()];

    while let Some(node) = stack.pop() {
        if node.kind() == SyntaxKind::Equation {
            ranges.push(node.range());
            continue;
        }

        stack.extend(node.children());
    }

    ranges.sort_by_key(|range| range.start);
    ranges
}

/// Wraps a block of Typst source for rendering, recording the copy and the
/// generated wrapper text in the builder's map.
#[typst_macros::time]
fn wrap_block(
    builder: &mut SourceBuilder,
    last_block: &mut SynthBlock,
    last_kind: Option<SyntaxKind>,
) {
    match last_kind {
        Some(
            SyntaxKind::LetBinding
            | SyntaxKind::SetRule
            | SyntaxKind::ShowRule
            | SyntaxKind::ModuleImport
            | SyntaxKind::ModuleInclude
            | SyntaxKind::Contextual
            | SyntaxKind::Linebreak
            | SyntaxKind::Semicolon
            | SyntaxKind::LineComment
            | SyntaxKind::BlockComment,
        ) => {
            builder.copy(last_block.range.clone());
        }
        Some(SyntaxKind::ListItem | SyntaxKind::EnumItem | SyntaxKind::TermItem) => {
            builder.copy(last_block.range.clone());
            last_block.inline = true;
            last_block.list_item = true;
        }
        Some(SyntaxKind::Label) => {
            builder.copy(last_block.range.clone());
            last_block.inline = true;
        }
        _ => {
            builder.generated(
                last_block.range.start,
                "#block(stroke:0pt,width:100%)[",
                SegmentKind::Wrapper,
            );
            builder.copy(last_block.range.clone());
            builder.generated(last_block.range.end, "\n]", SegmentKind::Wrapper);
            last_block.inline = true;
            last_block.math = matches!(last_kind, Some(SyntaxKind::Equation | SyntaxKind::Math));
        }
    }

    builder.generated(last_block.range.end, "\n", SegmentKind::Separator);
}
