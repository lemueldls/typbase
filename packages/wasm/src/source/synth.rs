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

/// The result of a synth-building pass.
pub struct SynthResult {
    /// The top-level blocks discovered in the (repaired) raw source, in source
    /// order. Each block's `range` is in repaired-source bytes.
    pub blocks: Vec<SynthBlock>,

    /// Repaired-source ranges of all top-level `equation` nodes, used by the
    /// math error recovery pass to scope finer-grained fixes.
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
///   is never mutated after this call; [`SourceMap`] describes it, and
///   diagnostics-only compiles read it.
/// - The **render synth** (`context.render_id`), built from the *repaired*
///   raw text (missing `$` and quotes closed). Error recovery rewrites ranges
///   of it; the pristine file stays untouched.
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
    let fixups = RawFixups::new(delimiters::find_fixes(text), text.len());
    let repaired = fixups.repaired(text);

    let render = build_synth(&repaired, &prelude);
    let pristine = if fixups.is_empty() {
        None
    } else {
        Some(build_synth(text, &prelude))
    };

    context.raw_source_mut(world).unwrap().replace(text);

    let (pristine_synth, index_map) = match pristine {
        Some(pristine) => (pristine.synth, pristine.map),
        None => (render.synth.clone(), render.map.clone()),
    };

    // Clone the prepared `Source` instead of the text: the text is refcounted
    // inside it, so the IDE and synth ids share one allocation.
    let synth_source = Source::new(context.synth_id, pristine_synth);
    world.insert_source_object(context.ide_id, synth_source.clone());
    world.insert_source_object(context.synth_id, synth_source);
    world.insert_source_object(
        context.render_id,
        Source::new(context.render_id, render.synth),
    );

    context.index_map = index_map;
    context.render_map = render.map;
    context.render_fixups = fixups;
    context.marked_raw_ranges.clear();

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

/// Vertical space emitted for one blank line, in ems. The editor's line
/// height is 1.4, so a blank source line occupies 1.4em there too.
const BLANK_LINE_EM: f64 = 1.4;

/// Emits `#v(...)` for the blank lines that sat between two blocks. One blank
/// line in the editor is one line height; the compiled output adds that on top
/// of Typst's normal block spacing, so the PDF and read view keep the
/// paragraph gaps the source shows.
///
/// Runs of blank lines collapse into one, the same way the editor treats them
/// as a single visual break, and leading blank lines add nothing.
fn emit_blank_lines(builder: &mut SourceBuilder, at: usize, blank_lines: usize) {
    if blank_lines == 0 {
        return;
    }

    // The trailing newline matters: the next block must start at the beginning
    // of a line, or a list marker, heading, or code fence glued to `#v(...)`
    // parses as plain text.
    builder.generated(
        at,
        &format!("#v({BLANK_LINE_EM}em)\n"),
        SegmentKind::Spacing,
    );
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
/// List items, enum items, term items, and labels are marked inline rather than
/// block-wrapped, because boxing them changes how they sit relative to
/// their siblings.
///
/// ## Inline items
///
/// A sequence of nodes with no newline between them (e.g. an inline equation in
/// the middle of a sentence) is collected into a single block. The
/// `SynthBlock::inline` flag is set on any block containing a node from the
/// inline category.
#[typst_macros::time]
fn build_synth(text: &str, prelude: &str) -> SynthBuild {
    let mut builder = SourceBuilder::new(text);
    builder.prefix(prelude);

    let root = typst_syntax::parse(text);
    let linked = LinkedNode::new(&root);

    let mut equation_ranges = Vec::new();

    let mut blocks = Vec::<SynthBlock>::new();
    let mut in_block = false;

    let mut last_kind: Option<SyntaxKind> = None;

    for node in linked.children() {
        let range = node.range();

        if node.kind() == SyntaxKind::Equation {
            equation_ranges.push(range.clone());
        }

        if let Some(until_newline) = node.get().leaf_text().chars().position(|ch| ch == '\n') {
            in_block = false;

            let leaf = node.get().leaf_text();
            let newlines = leaf.matches('\n').count();

            if let Some(last_block) = blocks.last_mut() {
                last_block.range.end += until_newline;
                // The first newline ends the block's last line; every newline
                // after it is a blank line in the editor. Leading blank lines
                // are dropped: the first block sits at the top.
                let blank_lines = newlines.saturating_sub(1);
                wrap_block(&mut builder, last_block, last_kind);
                emit_blank_lines(&mut builder, last_block.range.end, blank_lines);
            }
        } else {
            last_kind = Some(node.kind());

            if in_block {
                blocks.last_mut().unwrap().range.end = range.end;
            } else {
                in_block = true;

                blocks.push(SynthBlock {
                    range,
                    inline: false,
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
        Some(
            SyntaxKind::ListItem | SyntaxKind::EnumItem | SyntaxKind::TermItem | SyntaxKind::Label,
        ) => {
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
        }
    }

    builder.generated(last_block.range.end, "\n", SegmentKind::Separator);
}
