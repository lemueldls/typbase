//! Syntax-level passes shared by search, the section store, and notebooks.
//!
//! [`flatten_document`] turns Typst markup into plain text per block with a
//! byte map back to the raw source, so FTS hits land in the editor.
//! [`extract_sections`] finds `#typbase.section(kind: "...")[...]` calls and
//! reports their content ranges, populating the page doc's `sections` list.
//! [`extract_cells`] finds notebook cell markers (`// %%`) and reports their
//! spans in UTF-16, ready for CodeMirror.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use typst_syntax::{
    LinkedNode, SyntaxKind,
    ast::{Arg, AstNode, Expr, FuncCall},
};

/// One flattened source block. `map[i]` is the raw byte offset of plain byte
/// `i`. FTS offsets in `plain` translate through it to editor positions.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct FlattenedBlock {
    pub kind: String,
    pub plain: String,
    pub range_start: usize,
    pub range_end: usize,
    pub map: Vec<u32>,
}

/// A `#typbase.section(kind: ...)[...]` block. Ranges are raw source bytes.
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

/// A notebook cell: one `// %%` marker line plus the content below it, up to
/// the next marker or the end of the document. Ranges are UTF-16 offsets into
/// the raw source, so they can be used as editor positions directly.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CellSpan {
    /// `"prose"`, `"code"`, `"log"`, or `"hidden"`.
    pub kind: String,
    /// `name=` from the attribute line, when it carries one.
    pub name: Option<String>,
    /// Attribute line range, excluding the newline. Both zero on a cell that
    /// began at a heading and on the implicit cell above the first boundary.
    pub marker_start: usize,
    pub marker_end: usize,
    /// Content range. Blank lines below the content belong to the gap before
    /// the next boundary and are excluded.
    pub content_start: usize,
    pub content_end: usize,
}

/// Flattens a whole document into per-block plain text.
pub fn flatten_document(text: &str) -> Vec<FlattenedBlock> {
    let root = typst_syntax::parse(text);
    flatten_document_root(&root, text)
}

/// `flatten_document` over a tree the caller already has.
pub fn flatten_document_root(root: &typst_syntax::SyntaxNode, text: &str) -> Vec<FlattenedBlock> {
    let linked = LinkedNode::new(root);
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
/// raw byte offsets stay in lockstep.
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
    extract_sections_root(&root, text)
}

/// `extract_sections` over a tree the caller already has.
pub fn extract_sections_root(root: &typst_syntax::SyntaxNode, text: &str) -> Vec<SectionSpan> {
    let mut sections = Vec::new();
    let mut stack = vec![LinkedNode::new(root)];

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

    // The content block sits directly inside the Args node (after the parens).
    // Its Markup child carries the content range. AST wrappers do not expose
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

/// What a cell attribute line declares.
pub struct CellAttribute {
    pub kind: String,
    pub name: Option<String>,
}

/// The cell kinds an attribute line can name. Unlisted is prose, which is also
/// what an attribute line with no `kind=` says.
const CELL_KINDS: &[&str] = &["prose", "code", "log", "hidden"];

/// Reads a cell attribute line
fn cell_attribute(comment: &str) -> Option<CellAttribute> {
    let rest = comment.strip_prefix("//")?.trim_start();

    // `// %%`, the form notebooks were written in. Read so an existing notebook
    // keeps its cells; the label set is the old one.
    if let Some(rest) = rest.strip_prefix("%%") {
        let label = rest
            .trim()
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or(rest.trim())
            .trim()
            .to_ascii_lowercase();

        if label.is_empty() {
            return Some(CellAttribute {
                kind: String::from("prose"),
                name: None,
            });
        }

        // Display math was its own kind and rendered in place, which is what
        // prose does, so it maps across.
        return match label.as_str() {
            "markup" | "content" | "text" | "math" => Some(CellAttribute {
                kind: String::from("prose"),
                name: None,
            }),
            "code" | "script" | "scripting" => Some(CellAttribute {
                kind: String::from("code"),
                name: None,
            }),
            _ => None,
        };
    }

    // `//%`. Checked after `%%` so the two spellings do not overlap.
    let attrs = rest.strip_prefix('%')?.trim();

    let mut kind: Option<String> = None;
    let mut name: Option<String> = None;
    for field in attrs.split_whitespace() {
        let (key, value) = field.split_once('=')?;

        match key.to_ascii_lowercase().as_str() {
            "kind" => {
                let value = value.to_ascii_lowercase();
                if !CELL_KINDS.contains(&value.as_str()) {
                    return None;
                }
                kind = Some(value);
            }
            "name" => name = Some(value.to_string()),
            _ => return None,
        }
    }

    Some(CellAttribute {
        kind: kind.unwrap_or_else(|| String::from("prose")),
        name,
    })
}

/// Cells in raw-byte coordinates, before the UTF-16 conversion.
struct CellBytes {
    kind: String,
    name: Option<String>,
    marker_start: usize,
    marker_end: usize,
    content_start: usize,
    content_end: usize,
}

/// Finds notebook cells.
///
/// Only top-level line comments count, so an attribute line inside a raw block,
/// a code block, or a nested content block stays text.
pub fn extract_cells(text: &str) -> Vec<CellSpan> {
    let root = typst_syntax::parse(text);
    extract_cells_root(&root, text)
}

/// `extract_cells` over a tree the caller already has.
pub fn extract_cells_root(root: &typst_syntax::SyntaxNode, text: &str) -> Vec<CellSpan> {
    let linked = LinkedNode::new(root);

    // A boundary is a line start, the kind it declares, and whether it declared
    // one at all (a heading carries no attribute, so it is always prose).
    struct Boundary {
        line_start: usize,
        attribute: Option<CellAttribute>,
    }

    let mut boundaries: Vec<Boundary> = Vec::new();

    for child in linked.children() {
        // A heading carries no attribute, so `None` here means "prose". A
        // comment has to name a known kind or it is just a comment.
        let attribute = match child.kind() {
            SyntaxKind::Heading => None,
            SyntaxKind::LineComment => match text.get(child.range()).and_then(cell_attribute) {
                Some(attribute) => Some(attribute),
                None => continue,
            },
            _ => continue,
        };

        let range = child.range();
        let line_start = text[..range.start].rfind('\n').map_or(0, |index| index + 1);
        // The attribute range covers the line from its start, so an attribute
        // sharing its line with content would swallow it.
        if attribute.is_some() && !text[line_start..range.start].trim().is_empty() {
            continue;
        }

        boundaries.push(Boundary {
            line_start,
            attribute,
        });
    }

    boundaries.sort_by_key(|boundary| boundary.line_start);

    if boundaries.is_empty() {
        return to_spans(
            text,
            vec![CellBytes {
                kind: String::from("prose"),
                name: None,
                marker_start: 0,
                marker_end: 0,
                content_start: 0,
                content_end: text.len(),
            }],
        );
    }

    let mut cells: Vec<CellBytes> = Vec::new();

    // Content above the first boundary is a cell of its own, but a document that
    // starts with one does not get an empty leading cell.
    let leading_end = trim_trailing_blank(text, 0, boundaries[0].line_start);
    if !text[..leading_end].trim().is_empty() {
        cells.push(CellBytes {
            kind: String::from("prose"),
            name: None,
            marker_start: 0,
            marker_end: 0,
            content_start: 0,
            content_end: leading_end,
        });
    }

    for (index, boundary) in boundaries.iter().enumerate() {
        let next_start = boundaries
            .get(index + 1)
            .map_or(text.len(), |next| next.line_start);
        // A heading's own line is content, so the cell starts there. An
        // attribute line is not: it is replaced by the header, so the content
        // starts on the line after it.
        let is_heading = boundary.attribute.is_none();
        let marker_end = if is_heading {
            boundary.line_start
        } else {
            line_end(text, boundary.line_start)
        };
        let content_start = if is_heading {
            boundary.line_start
        } else {
            after_line(text, marker_end)
        };
        let content_end = trim_trailing_blank(text, content_start, next_start);

        cells.push(CellBytes {
            kind: boundary
                .attribute
                .as_ref()
                .map_or_else(|| String::from("prose"), |attribute| attribute.kind.clone()),
            name: boundary
                .attribute
                .as_ref()
                .and_then(|attribute| attribute.name.clone()),
            marker_start: boundary.line_start,
            marker_end,
            content_start,
            content_end,
        });
    }

    to_spans(text, cells)
}

/// End of the line starting at `start`, excluding the newline.
fn line_end(text: &str, start: usize) -> usize {
    text[start..]
        .find('\n')
        .map_or(text.len(), |offset| start + offset)
}

/// First byte after the line ending at `end`, or the end of the text when the
/// line has no newline.
fn after_line(text: &str, end: usize) -> usize {
    if end < text.len() && text.as_bytes()[end] == b'\n' {
        end + 1
    } else {
        text.len()
    }
}

/// Walks back over blank or whitespace-only lines in `start..end` and returns
/// the offset just past the last non-whitespace character.
fn trim_trailing_blank(text: &str, start: usize, end: usize) -> usize {
    let mut cut = end;

    for line in text[start..end].split_inclusive('\n').rev() {
        if line.trim().is_empty() {
            cut -= line.len();
        } else {
            break;
        }
    }

    let trimmed = text[start..cut].trim_end();

    start + trimmed.len()
}

/// Converts the four byte boundaries of every cell to UTF-16 in one pass.
/// The boundaries arrive sorted, which the walk relies on.
fn to_spans(text: &str, cells: Vec<CellBytes>) -> Vec<CellSpan> {
    let mut bytes = Vec::with_capacity(cells.len() * 4);
    for cell in &cells {
        bytes.push(cell.marker_start);
        bytes.push(cell.marker_end);
        bytes.push(cell.content_start);
        bytes.push(cell.content_end);
    }

    let utf16 = utf16_offsets(text, &bytes);

    cells
        .into_iter()
        .enumerate()
        .map(|(index, cell)| CellSpan {
            kind: cell.kind,
            name: cell.name,
            marker_start: utf16[index * 4],
            marker_end: utf16[index * 4 + 1],
            content_start: utf16[index * 4 + 2],
            content_end: utf16[index * 4 + 3],
        })
        .collect()
}

/// Maps sorted byte offsets to UTF-16 offsets. Offsets must sit on char
/// boundaries, which line boundaries always do. Shared with [`crate::links`],
/// whose ranges feed CodeMirror positions.
pub(crate) fn utf16_offsets(text: &str, bytes: &[usize]) -> Vec<usize> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    let mut utf16 = 0;

    for &byte in bytes {
        while cursor < byte {
            let Some(ch) = text[cursor..].chars().next() else {
                break;
            };
            cursor += ch.len_utf8();
            utf16 += ch.len_utf16();
        }
        out.push(utf16);
    }

    out
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

    #[test]
    fn splits_cells_by_attribute() {
        let text = "//% name=intro\nProse.\n\n//% kind=code\n#let x = 1\n\n//% kind=log\n#x\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 3);
        assert_eq!(cells[0].kind, "prose");
        assert_eq!(cells[0].name.as_deref(), Some("intro"));
        assert_eq!(cells[1].kind, "code");
        assert_eq!(cells[2].kind, "log");
        assert_eq!(
            &text[cells[0].content_start..cells[0].content_end],
            "Prose."
        );
        assert_eq!(
            &text[cells[1].content_start..cells[1].content_end],
            "#let x = 1"
        );
        assert_eq!(&text[cells[2].content_start..cells[2].content_end], "#x");
        assert_eq!(
            &text[cells[1].marker_start..cells[1].marker_end],
            "//% kind=code"
        );
    }

    /// A heading is a boundary wherever it is, so it splits the cell the attribute
    /// above it opened. That cell is left empty, which is the same shape as an
    /// attribute with nothing between it and the next attribute.
    #[test]
    fn a_heading_splits_an_attributed_cell() {
        let text = "//%\n= Title\n\nBody.\n";
        let cells = extract_cells(text);

        assert_eq!(cells.len(), 2);
        assert_eq!(cells[0].content_start, cells[0].content_end);
        assert_eq!(
            &text[cells[1].content_start..cells[1].content_end],
            "= Title\n\nBody."
        );
        // The heading cell has no attribute line of its own.
        assert_eq!(cells[1].marker_start, cells[1].marker_end);
    }

    #[test]
    fn no_boundaries_is_one_implicit_cell() {
        let text = "Paragraph.\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].kind, "prose");
        assert_eq!(cells[0].content_start, 0);
        assert_eq!(cells[0].content_end, text.len());
        assert_eq!(cells[0].marker_start, cells[0].marker_end);
    }

    #[test]
    fn leading_content_becomes_a_cell() {
        let text = "= Intro\n\n//% kind=code\nBody\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 2);
        assert_eq!(
            &text[cells[0].content_start..cells[0].content_end],
            "= Intro"
        );
        assert_eq!(cells[0].marker_start, cells[0].marker_end);
        assert_eq!(&text[cells[1].content_start..cells[1].content_end], "Body");
    }

    #[test]
    fn keeps_empty_cells() {
        let text = "//%\n\n//% kind=code\n#let x = 1\n\n//% kind=code\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 3);
        assert_eq!(cells[0].content_start, cells[0].content_end);
        assert_eq!(cells[2].content_start, cells[2].content_end);
    }

    #[test]
    fn attributes_inside_raw_and_code_blocks_are_text() {
        let text = "//%\n```\n//%\n```\n\n#{\n  //%\n  let x = 1\n}\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].kind, "prose");
    }

    #[test]
    fn trailing_blank_lines_belong_to_the_gap() {
        let text = "//%\n#let x = 1\n\n\n//% kind=code\n#x\n";
        let cells = extract_cells(text);
        assert_eq!(
            &text[cells[0].content_start..cells[0].content_end],
            "#let x = 1"
        );
    }

    #[test]
    fn unknown_kinds_are_comments() {
        let text = "//% kind=widget\n#let x = 1\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].content_start, 0);
    }

    #[test]
    fn cell_ranges_are_utf16() {
        // "é" is one UTF-16 unit in two UTF-8 bytes. The emoji is two units in
        // four bytes. Offsets after them must count code units, not bytes.
        let text = "//%\nHéllo 🎉\n\n//% kind=code\n#x\n";
        let cells = extract_cells(text);
        assert_eq!(cells.len(), 2);

        let boundary = text.find("\n\n//%").unwrap();
        let expected = text[..boundary].chars().map(char::len_utf16).sum::<usize>();
        assert_eq!(cells[0].content_end, expected);

        let second = text.rfind("//%").unwrap() + "//% kind=code\n".len();
        let second_start = text[..second].chars().map(char::len_utf16).sum::<usize>();
        assert_eq!(cells[1].content_start, second_start);
        assert_eq!(cells[1].content_end, second_start + 2);
    }
}
