use std::ops::Range;

use typst_syntax::{LinkedNode, SyntaxKind};

use crate::{
    bindings::TypstFileId,
    source::{AnchorKind, DelimiterFix, IndexMapper, RawFixups, SourceContext, delimiters},
    state::TypstState,
    world::TypstWorld,
};

/// The result of a synth-building pass.
pub struct SynthResult {
    /// The render source text: the repaired raw source with the prelude and
    /// block wrappers applied. This is what the renderer compiles.
    pub synth: String,

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

/// Builds all source files for a note and updates its mappers.
///
/// Three texts are involved:
///
/// - The **raw** text, exactly what the user typed. All editor positions are
///   in raw coordinates.
/// - The **pristine synth** (`context.synth_id`), built from the raw text. It
///   is never mutated after this call; [`IndexMapper`](crate::source::IndexMapper)
///   describes it, and diagnostics-only compiles read it.
/// - The **render synth** (`context.render_id`), built from the *repaired*
///   raw text (missing `$` and quotes closed). Error recovery replaces ranges
///   of it; the pristine file stays untouched.
///
/// When no repair is needed the render synth is byte-identical to the
/// pristine one and the two mappers match.
#[typst_macros::time]
pub fn sync_source_context(
    text: &str,
    prelude: String,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> SynthResult {
    let fixups = RawFixups::new(delimiters::find_fixes(text));
    let repaired = fixups.repaired(text);

    let render = build_synth(&repaired, &prelude);
    let pristine = if fixups.is_empty() {
        None
    } else {
        Some(build_synth(text, &prelude))
    };

    context.raw_source_mut(world).unwrap().replace(text);

    let (pristine_synth, index_mapper) = match pristine {
        Some(pristine) => (pristine.synth, pristine.mapper),
        None => (render.synth.clone(), render.mapper.clone()),
    };

    world.insert_source(context.ide_id, pristine_synth.clone());
    world.insert_source(context.synth_id, pristine_synth);
    world.insert_source(context.render_id, render.synth.clone());

    context.index_mapper = index_mapper;
    context.render_mapper = render.mapper;
    context.render_fixups = fixups;
    context.marked_raw_ranges.clear();

    world.main_id = Some(context.synth_id);

    SynthResult {
        synth: render.synth,
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
    mapper: IndexMapper,
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
/// 3. Records an [`IndexMapper`] anchor at every point where text was inserted
///    or the alignment between source and synth shifted.
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
    let mut synth = String::from(prelude);
    let mut mapper = IndexMapper::default();

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

            if let Some(last_block) = blocks.last_mut() {
                last_block.range.end += until_newline;
                wrap_block(&mut synth, text, last_block, last_kind, &mut mapper);
            }
        } else {
            last_kind = Some(node.kind());

            if in_block {
                blocks.last_mut().unwrap().range.end = range.end;
            } else {
                in_block = true;

                mapper.push_raw_to_synth_with_kind(
                    range.start,
                    synth.len(),
                    AnchorKind::BlockStart,
                );
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
        wrap_block(&mut synth, text, last_block, last_kind, &mut mapper);
    }

    SynthBuild {
        synth,
        blocks,
        equation_ranges,
        mapper,
    }
}

/// Wraps a block of Typst source for rendering, updating the intermediate
/// representation and block metadata.
#[typst_macros::time]
fn wrap_block(
    synth: &mut String,
    text: &str,
    last_block: &mut SynthBlock,
    last_kind: Option<SyntaxKind>,
    mapper: &mut IndexMapper,
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
            *synth += &text[last_block.range.clone()];
        }
        Some(
            SyntaxKind::ListItem | SyntaxKind::EnumItem | SyntaxKind::TermItem | SyntaxKind::Label,
        ) => {
            *synth += &text[last_block.range.clone()];
            last_block.inline = true;
        }
        _ => {
            *synth += "#block(stroke:0pt,width:100%)[";
            mapper.push_raw_to_synth_with_kind(
                last_block.range.start,
                synth.len(),
                AnchorKind::WrapperOpen,
            );
            *synth += &text[last_block.range.clone()];
            mapper.push_raw_to_synth_with_kind(
                last_block.range.end,
                synth.len(),
                AnchorKind::WrapperClose,
            );
            *synth += "\n]";

            last_block.inline = true;
        }
    }

    mapper.push_raw_to_synth_with_kind(last_block.range.end, synth.len(), AnchorKind::BlockEnd);
    *synth += "\n";
    mapper.push_raw_to_synth_with_kind(last_block.range.end, synth.len(), AnchorKind::BlockNewline);
}
