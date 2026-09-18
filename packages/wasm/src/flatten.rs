//! Syntax-level passes shared by search and the section store.
//!
//! [`flatten_document`] turns Typst markup into plain text per block with a
//! byte map back to the raw source, so FTS hits land in the editor.
//! [`extract_sections`] finds `#typbase.section(kind: "...")[...]` calls and
//! reports their content ranges, populating the page doc's `sections` list.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use typst_syntax::{
    LinkedNode, SyntaxKind,
    ast::{Arg, AstNode, Expr, FuncCall},
};

/// One flattened source block. `map[i]` is the raw byte offset of plain byte
/// `i`; FTS offsets in `plain` translate through it to editor positions.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct FlattenedBlock {
    pub kind: String,
    pub plain: String,
    pub range_start: usize,
    pub range_end: usize,
    pub map: Vec<u32>,
}

/// A `#typbase.section(kind: ...)[...]` block. Ranges are raw source bytes;
/// `content_start..content_end` is the markup inside the brackets.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SectionSpan {
    pub kind: String,
    pub content_start: usize,
    pub content_end: usize,
    pub full_start: usize,
    pub full_end: usize,
    pub title: String,
}

/// Flattens a whole document into per-block plain text.
pub fn flatten_document(text: &str) -> Vec<FlattenedBlock> {
    let root = typst_syntax::parse(text);
    let linked = LinkedNode::new(&root);
    let children: Vec<LinkedNode> = linked.children().collect();

    let mut out = Vec::new();
    let mut run: Vec<LinkedNode> = Vec::new();

    // Inline markup splits prose across several top-level nodes (Text/"Strong"
    // etc), so gather a run of flow nodes into one paragraph block. Block
    // starts (headings, list items, raw, math) each get their own block.
    for child in &children {
        match child.kind() {
            SyntaxKind::Heading
            | SyntaxKind::ListItem
            | SyntaxKind::EnumItem
            | SyntaxKind::TermItem
            | SyntaxKind::Raw
            | SyntaxKind::Equation
            | SyntaxKind::Math => {
                emit_run(&mut run, &mut out, text, "paragraph");
                emit_node(child, &mut out, text);
            }
            SyntaxKind::Parbreak => {
                emit_run(&mut run, &mut out, text, "paragraph");
            }
            _ => run.push(child.clone()),
        }
    }
    emit_run(&mut run, &mut out, text, "paragraph");

    out
}

fn emit_run(run: &mut Vec<LinkedNode>, out: &mut Vec<FlattenedBlock>, text: &str, kind: &str) {
    if run.is_empty() {
        return;
    }

    let first = run.first().unwrap();
    let last = run.last().unwrap();
    let range = first.range().start..last.range().end;

    let mut plain = String::new();
    let mut map = Vec::new();
    for node in run.drain(..) {
        flatten_node(&node, text, &mut plain, &mut map);
    }
    push_block(out, kind.to_string(), plain, map, range, text);
}

fn emit_node(node: &LinkedNode, out: &mut Vec<FlattenedBlock>, text: &str) {
    let kind = block_kind(node.kind());
    let range = node.range();
    let mut plain = String::new();
    let mut map = Vec::new();
    flatten_node(node, text, &mut plain, &mut map);
    push_block(out, kind, plain, map, range, text);
}

fn push_block(
    out: &mut Vec<FlattenedBlock>,
    kind: String,
    plain: String,
    map: Vec<u32>,
    range: std::ops::Range<usize>,
    _text: &str,
) {
    if plain.trim().is_empty() {
        return;
    }

    // Trim keeps the map aligned: drop the same window from both.
    let leading = plain.len() - plain.trim_start().len();
    let trailing = plain.len() - plain.trim_end().len();
    let plain = plain.trim().to_string();
    let map = if leading == 0 && trailing == 0 {
        map
    } else {
        let end = map.len() - trailing.min(map.len());
        map[leading.min(map.len())..end].to_vec()
    };

    out.push(FlattenedBlock {
        kind,
        plain,
        range_start: range.start,
        range_end: range.end,
        map,
    });
}

fn block_kind(kind: SyntaxKind) -> String {
    match kind {
        SyntaxKind::Heading => "heading",
        SyntaxKind::ListItem | SyntaxKind::EnumItem | SyntaxKind::TermItem => "list",
        SyntaxKind::Raw => "raw",
        SyntaxKind::Equation | SyntaxKind::Math => "math",
        _ => "other",
    }
    .to_string()
}

/// Recursively collects leaf text, skipping markup markers. Plain bytes and
/// raw byte offsets stay in lockstep, which is the whole point.
fn flatten_node(node: &LinkedNode, src: &str, plain: &mut String, map: &mut Vec<u32>) {
    match node.kind() {
        SyntaxKind::Text
        | SyntaxKind::Code
        | SyntaxKind::Space
        | SyntaxKind::Linebreak
        | SyntaxKind::MathIdent
        | SyntaxKind::MathText
        | SyntaxKind::Str => {
            let range = node.range();
            let Some(chunk) = src.get(range.clone()) else {
                return;
            };

            if chunk == "\n" {
                plain.push(' ');
                map.push(range.start as u32);
            } else {
                plain.push_str(chunk);
                map.extend(range.clone().map(|offset| offset as u32));
            }
        }
        _ => {
            for child in node.children() {
                flatten_node(&child, src, plain, map);
            }
        }
    }
}

/// Finds every `typbase.section` call and its content block.
pub fn extract_sections(text: &str) -> Vec<SectionSpan> {
    let root = typst_syntax::parse(text);
    let mut sections = Vec::new();
    let mut stack = vec![LinkedNode::new(&root)];

    while let Some(node) = stack.pop() {
        if let Some(call) = node.get().cast::<FuncCall>() {
            if is_section_call(&call) {
                if let Some(span) = section_span(&call, &node, text) {
                    sections.push(span);
                }
            }
        }
        for child in node.children() {
            stack.push(child);
        }
    }

    sections.sort_by_key(|section| section.content_start);
    sections
}

fn is_section_call(call: &FuncCall) -> bool {
    call.callee().to_untyped().full_text().as_str() == "typbase.section"
}

fn section_span(call: &FuncCall, node: &LinkedNode, text: &str) -> Option<SectionSpan> {
    let mut kind: Option<String> = None;

    for arg in call.args().items() {
        if let Arg::Named(named) = arg {
            if named.name().get() == "kind" {
                if let Expr::Str(value) = named.expr() {
                    kind = Some(value.get().to_string());
                }
            }
        }
    }
    let kind = kind?;

    // The content block sits directly inside the Args node (after the parens);
    // its Markup child carries the content range. AST wrappers do not expose
    // ranges, so walk with LinkedNode directly.
    let mut content_range = None;
    for arg_list in node.children() {
        if arg_list.kind() != SyntaxKind::Args {
            continue;
        }
        for item in arg_list.children() {
            if item.kind() != SyntaxKind::ContentBlock {
                continue;
            }
            for body in item.children() {
                if body.kind() == SyntaxKind::Markup {
                    content_range = Some(body.range());
                }
            }
        }
    }
    let content_range = content_range?;
    if content_range.start >= content_range.end {
        return None;
    }

    let full_range = node.range();
    let title = make_title(&text[content_range.start..content_range.end]);

    Some(SectionSpan {
        kind,
        content_start: content_range.start,
        content_end: content_range.end,
        full_start: full_range.start,
        full_end: full_range.end,
        title,
    })
}

/// Cheap title: strip leading markers and collapse whitespace.
fn make_title(content: &str) -> String {
    let mut title = String::new();
    for ch in content.chars() {
        match ch {
            '=' | '#' | '-' | '*' | '_' | '`' | '$' | '[' | ']' | '(' | ')' | '{' | '}' => {
                continue;
            }
            ch if ch.is_whitespace() => {
                if !title.is_empty() && !title.ends_with(' ') {
                    title.push(' ');
                }
            }
            ch => title.push(ch),
        }
        if title.len() >= 64 {
            break;
        }
    }
    title.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattens_headings_and_paragraphs() {
        let blocks = flatten_document("= Title\n\nHello *world* today.\n\n- one\n- two\n");
        assert!(blocks.len() >= 3);
        assert_eq!(blocks[0].kind, "heading");
        assert!(blocks[0].plain.contains("Title"));
        assert_eq!(blocks[1].kind, "paragraph");
        assert!(blocks[1].plain.contains("Hello world today."));
        // The map must stay in-sync with the plain string.
        for block in &blocks {
            assert_eq!(
                block.plain.len(),
                block.map.len(),
                "map length for {:?}",
                block
            );
        }
    }

    #[test]
    fn flatten_keeps_raw_and_math() {
        let blocks = flatten_document("```rs\nfn main() {}\n```\n\n$x^2 + 1$\n");
        let kinds: Vec<&str> = blocks.iter().map(|b| b.kind.as_str()).collect();
        assert!(kinds.contains(&"raw"));
        assert!(kinds.contains(&"math"));
    }

    #[test]
    fn extracts_sections() {
        let text = "#typbase.section(kind: \"flashcards\")[\n  == Flashcard\n  Q? A\n]\n\n#typbase.section(kind: \"summary\")[Plain text]\n";
        let sections = extract_sections(text);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].kind, "flashcards");
        assert_eq!(sections[1].kind, "summary");
        assert!(sections[0].title.contains("Flashcard"));
        let content = &text[sections[0].content_start..sections[0].content_end];
        assert!(content.contains("== Flashcard"));
    }

    #[test]
    fn ignores_other_section_calls() {
        let text = "#other.section(kind: \"x\")[nope]\n";
        assert!(extract_sections(text).is_empty());
    }
}
