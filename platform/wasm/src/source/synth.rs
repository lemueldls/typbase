use std::ops::Range;

use typst::{
    WorldExt,
    syntax::{SyntaxKind, SyntaxNode},
};

use crate::{
    bindings::TypstFileId,
    source::{AnchorKind, IndexMapper, SourceContext},
    state::TypstState,
    world::TypstWorld,
};

/// The result of a synth-building pass.
pub struct SynthResult {
    /// The full synth string, ready for Typst to compile.
    pub synth: String,

    /// The top-level blocks discovered in the raw source, in source order.
    /// Each block's `range` is in raw bytes.
    pub blocks: Vec<SynthBlock>,

    /// Raw source ranges of all top-level `equation` nodes, used by the math
    /// error recovery pass to scope finer-grained fixes.
    pub equation_ranges: Vec<Range<usize>>,
}

/// A top-level node or contiguous run of nodes from the raw source,
/// corresponding to one independently renderable chunk.
#[derive(Debug, Clone)]
pub struct SynthBlock {
    /// Byte range in the **raw** source. This is the range the rendered chunk
    /// maps back to in the editor.
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

/// Builds the synth from the raw source.
///
/// Walks the raw source's top-level syntax nodes and produces an intermediate
/// source string that:
///
/// 1. Begins with the generated prelude (page geometry, color theme, text
///    defaults).
/// 2. Wraps each run of content-producing nodes in `#block(...)`. Purely
///    structural nodes (`let`, `set`, `show`, imports, comments) are passed
///    through unmodified.
/// 3. Records an [`IndexMapper`] anchor at every point where text was inserted
///    or the alignment between raw and synth shifted.
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
pub fn sync_source_context(
    text: &str,
    prelude: String,
    context: &mut SourceContext,
    world: &mut TypstWorld,
) -> SynthResult {
    let mut synth = prelude;

    context.index_mapper = IndexMapper::default();
    // context.index_mapper.add_raw_to_synth(0, ir.len());

    // context
    //     .synth_source_mut(&mut world)
    //     .unwrap()
    //     .replace(&ir);
    world.synth_id = Some(context.synth_id);

    context.raw_source_mut(world).unwrap().replace(text);
    world.raw_id = Some(context.raw_id);

    let raw_source = context.raw_source(world).unwrap();

    let children = raw_source.root().children();
    let text = raw_source.text();

    let mut equation_ranges = Vec::new();

    let mut blocks = Vec::<SynthBlock>::new();
    let mut in_block = false;

    let mut last_kind: Option<SyntaxKind> = None;

    for node in children {
        let range = world.range(node.span()).unwrap();

        if node.kind() == SyntaxKind::Equation {
            // crate::log!("[EQUATION]: {node:?}");
            equation_ranges.push(range.clone());
        }

        if let Some(until_newline) = node.leaf_text().chars().position(|ch| ch == '\n') {
            in_block = false;

            if let Some(last_block) = blocks.last_mut() {
                last_block.range.end += until_newline;
                wrap_block(&mut synth, text, last_block, last_kind, context);
            }
        } else {
            last_kind = Some(node.kind());

            if in_block {
                blocks.last_mut().unwrap().range.end = range.end;
            } else {
                in_block = true;

                context
                    .index_mapper
                    .push_raw_to_synth_with_kind(range.start, synth.len(), AnchorKind::BlockStart);
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
        wrap_block(&mut synth, text, last_block, last_kind, context);
    }

    SynthResult {
        synth,
        blocks,
        equation_ranges,
    }
}

fn flat_find_node_kind(node: &SyntaxNode, kind: SyntaxKind) -> Option<&SyntaxNode> {
    if node.kind() == kind {
        return Some(node);
    }
    for child in node.children() {
        if let Some(found) = flat_find_node_kind(child, kind) {
            return Some(found);
        }
    }

    None
}

/// Wraps a block of Typst source for rendering, updating the intermediate
/// representation and block metadata.
#[typst_macros::time]
fn wrap_block(
    synth: &mut String,
    text: &str,
    last_block: &mut SynthBlock,
    last_kind: Option<SyntaxKind>,
    context: &mut SourceContext,
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
            context
                .index_mapper
                .push_raw_to_synth_with_kind(last_block.range.start, synth.len(), AnchorKind::WrapperOpen);
            *synth += &text[last_block.range.clone()];
            context
                .index_mapper
                .push_raw_to_synth_with_kind(last_block.range.end, synth.len(), AnchorKind::WrapperClose);
            *synth += "\n]";

            last_block.inline = true;
        }
    }

    context
        .index_mapper
        .push_raw_to_synth_with_kind(last_block.range.end, synth.len(), AnchorKind::BlockEnd);
    *synth += "\n";
    context
        .index_mapper
        .push_raw_to_synth_with_kind(last_block.range.end, synth.len(), AnchorKind::BlockNewline);
}
