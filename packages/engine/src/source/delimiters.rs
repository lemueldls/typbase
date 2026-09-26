//! Delimiter repair for the render source.
//!
//! A missing closer makes the parser swallow the rest of the document and the
//! compile fails with "unclosed delimiter" no matter how many blocks get
//! blanked: blanking the block that holds the error removes the text the user
//! is trying to write. The fix is to close the delimiter.
//!
//! The repair runs on the raw text before the render synth is built, so the
//! block structure matches what the user sees after the fix (the paragraph
//! after an unclosed equation is a paragraph, not part of the equation).
//!
//! Covered constructs:
//!
//! - unclosed equations (`$`) and math strings (`"`)
//! - bare math attachments (`x_`, `x^`)
//! - unclosed raw blocks and inline raw (backticks)
//! - unclosed code blocks, content blocks, and grouping (`#{}`, `#[]`, `#()`)
//! - unclosed code strings (`"`)
//! - unclosed block comments (`/*`)
//!
//! Every closer lands at the first blank line inside the construct, or at the
//! construct's end when there is none. Blank lines separate blocks in the
//! editor, so that is the boundary the user meant while typing. Closers that
//! land at one offset are inserted inner-first, so nesting survives:
//! `#f(#[open` becomes `#f(#[open])`.
//!
//! Two coordinate spaces matter here:
//!
//! - `raw`: exactly the user's text.
//! - `repaired`: the raw text with closing delimiters inserted.
//!
//! [`RawFixups`] tracks the insertion points so diagnostics and jumps can be
//! translated between the two.

use std::ops::Range;

use typst_syntax::{LinkedNode, SyntaxKind};

use crate::{
    bindings::{TypstDiagnostic, TypstDiagnosticSeverity},
    source::{SegmentKind, SourceMap},
};

/// What a repair closes, and the token it inserts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixKind {
    /// Closing `$` for an unclosed equation.
    MathDollar,
    /// Closing `"` for an unclosed math string.
    MathQuote,
    /// `#none` placeholder for a math attachment with no argument.
    MathAttachment,
    /// Closing backticks for an unclosed raw. `run` is the opener's backtick
    /// count; `block` adds a leading newline so a fence lands on its own line.
    Raw { run: usize, block: bool },
    /// Closing `}` for an unclosed code block.
    CodeBlock,
    /// Closing `]` for an unclosed content block.
    ContentBlock,
    /// Closing `)` for an unclosed call, array, dict, or grouped expression.
    Grouping,
    /// Closing `"` for an unclosed code string.
    String,
    /// Closing `*/` for an unclosed block comment.
    BlockComment,
}

impl FixKind {
    /// The text this fix inserts.
    #[must_use]
    pub fn insertion(self) -> String {
        match self {
            Self::MathDollar => String::from("$"),
            Self::MathQuote | Self::String => String::from("\""),
            Self::MathAttachment => String::from("#none"),
            Self::Grouping => String::from(")"),
            Self::CodeBlock => String::from("}"),
            Self::ContentBlock => String::from("]"),
            Self::BlockComment => String::from("*/"),
            Self::Raw { run, block } => {
                let mut text = String::with_capacity(run + usize::from(block));

                if block {
                    text.push('\n');
                }

                for _ in 0..run {
                    text.push('`');
                }

                text
            }
        }
    }

    /// Byte length of [`Self::insertion`], without building it.
    #[must_use]
    pub const fn insertion_len(self) -> usize {
        match self {
            Self::MathDollar
            | Self::MathQuote
            | Self::String
            | Self::Grouping
            | Self::CodeBlock
            | Self::ContentBlock => 1,
            Self::MathAttachment => 5,
            Self::BlockComment => 2,
            Self::Raw { run, block } => run + if block { 1 } else { 0 },
        }
    }

    /// Warning shown when this fix is applied.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::MathDollar => "unclosed math equation; inserted a closing `$`",
            Self::MathQuote => "unclosed math string; inserted a closing `\"`",
            Self::MathAttachment => "empty math attachment; inserted `#none`",
            Self::Raw { block: true, .. } => "unclosed raw block; inserted a closing fence",
            Self::Raw { .. } => "unclosed raw text; inserted a closing backtick",
            Self::CodeBlock => "unclosed code block; inserted a closing `}`",
            Self::ContentBlock => "unclosed content block; inserted a closing `]`",
            Self::Grouping => "unclosed grouping; inserted a closing `)`",
            Self::String => "unclosed string; inserted a closing `\"`",
            Self::BlockComment => "unclosed block comment; inserted `*/`",
        }
    }
}

/// A delimiter inserted into the repaired source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DelimiterFix {
    /// Byte offset in the raw source where the insertion goes.
    pub raw_offset: usize,
    /// What the insertion closes.
    pub kind: FixKind,
}

/// Insertion points from raw to repaired text, plus the offset map they imply.
#[derive(Debug, Default, Clone)]
pub struct RawFixups {
    /// Sorted by raw offset. At one offset, inner closers come before outer
    /// ones (see [`find_fixes`]).
    fixes: Vec<DelimiterFix>,
    /// Raw to repaired offsets, built from the fix list.
    map: SourceMap,
}

impl RawFixups {
    #[must_use]
    pub fn new(mut fixes: Vec<DelimiterFix>, from_len: usize) -> Self {
        // Stable: collectors push inner closers before outer ones, and the
        // order must survive for nested constructs that close at one offset.
        fixes.sort_by_key(|fix| fix.raw_offset);
        fixes.dedup();

        let insertions = fixes
            .iter()
            .map(|fix| (fix.raw_offset, fix.kind.insertion()))
            .collect::<Vec<_>>();
        let borrows = insertions
            .iter()
            .map(|(offset, text)| (*offset, text.as_str()))
            .collect::<Vec<_>>();
        let map = SourceMap::from_insertions(from_len, &borrows, SegmentKind::Fixup);

        Self { fixes, map }
    }

    /// Whether the raw text needed no repair at all. In that case every
    /// repaired offset equals its raw offset and the maps are identical.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.fixes.is_empty()
    }

    #[must_use]
    pub fn fixes(&self) -> &[DelimiterFix] {
        &self.fixes
    }

    /// Raw to repaired offsets.
    #[must_use]
    pub const fn map(&self) -> &SourceMap {
        &self.map
    }

    /// The raw text with every fix applied.
    #[must_use]
    pub fn repaired(&self, raw: &str) -> String {
        if self.fixes.is_empty() {
            return raw.to_string();
        }

        let mut out = String::with_capacity(raw.len() + self.total_len());
        let mut cursor = 0;

        for fix in &self.fixes {
            if fix.raw_offset > cursor {
                out.push_str(&raw[cursor..fix.raw_offset]);
                cursor = fix.raw_offset;
            }
            out.push_str(&fix.kind.insertion());
        }

        out.push_str(&raw[cursor..]);
        out
    }

    fn total_len(&self) -> usize {
        self.fixes.iter().map(|fix| fix.kind.insertion_len()).sum()
    }
}

/// Reads the raw text and returns the closers it is missing.
///
/// Only errors that de-render the document are repaired: unclosed equations
/// and strings, bare math attachments, unclosed raw, code, and comment
/// constructs. Everything the parser already recovers on its own is left
/// alone.
#[must_use]
pub fn find_fixes(text: &str) -> Vec<DelimiterFix> {
    let root = typst_syntax::parse(text);
    let mut fixes = Vec::new();

    walk(&LinkedNode::new(&root), text, false, &mut fixes);

    RawFixups::new(fixes, text.len()).fixes().to_vec()
}

/// Diagnostics for the repairs that were applied, in raw coordinates.
///
/// The repaired document compiles without errors, so without these the user
/// would never see that a closing token was inserted for them.
#[must_use]
pub fn delimiter_diagnostics(fixups: &RawFixups, text: &str) -> Vec<TypstDiagnostic> {
    fixups
        .fixes()
        .iter()
        .map(|fix| {
            let start = utf16_len(&text[..fix.raw_offset.min(text.len())]);
            let end = (start + 1).min(utf16_len(text));

            TypstDiagnostic {
                range: start..end,
                severity: TypstDiagnosticSeverity::Warning,
                message: String::from(fix.kind.message()),
                hints: Box::default(),
                file: None,
                line: None,
            }
        })
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Finds every repair in the tree.
///
/// Children are visited before their parent so that closers pushed at one
/// offset come out inner-first. Equations keep their own pass; code inside
/// them is still visited, but math strings are not treated as code strings.
fn walk(node: &LinkedNode, text: &str, in_equation: bool, fixes: &mut Vec<DelimiterFix>) {
    if node.kind() == SyntaxKind::Equation && !in_equation {
        for child in node.children() {
            walk(&child, text, true, fixes);
        }

        collect_equation_fixes(node, text, fixes);
        return;
    }

    for child in node.children() {
        walk(&child, text, in_equation, fixes);
    }

    collect_container_fix(node, text, fixes);
    collect_error_leaf_fix(node, text, in_equation, fixes);
    collect_block_comment_fix(node, text, fixes);
}

/// Closes `#{}`, `#[]`, `#()`, calls, arrays, dicts, and parameter lists.
fn collect_container_fix(node: &LinkedNode, text: &str, fixes: &mut Vec<DelimiterFix>) {
    let kind = match node.kind() {
        SyntaxKind::CodeBlock => FixKind::CodeBlock,
        SyntaxKind::ContentBlock => FixKind::ContentBlock,
        SyntaxKind::Parenthesized
        | SyntaxKind::Array
        | SyntaxKind::Dict
        | SyntaxKind::Args
        | SyntaxKind::Params
        | SyntaxKind::Destructuring => FixKind::Grouping,
        _ => return,
    };

    // An unclosed construct parses its opening token as an error leaf
    // (`Error "("`); a closed one starts with LeftParen/LeftBrace/LeftBracket.
    let opener = match kind {
        FixKind::CodeBlock => "{",
        FixKind::ContentBlock => "[",
        _ => "(",
    };
    let unclosed = node.children().next().is_some_and(|child| {
        child.kind() == SyntaxKind::Error && child.get().leaf_text().starts_with(opener)
    });

    if !unclosed {
        return;
    }

    let close = close_offset(text, node.range());
    fixes.push(DelimiterFix {
        raw_offset: close,
        kind,
    });
}

/// Closes raw backticks and code strings.
///
/// The parser folds an unclosed raw into one error leaf whose text still
/// contains newlines, so both constructs show up as error leaves here. Math
/// strings are handled by the equation pass instead.
fn collect_error_leaf_fix(
    node: &LinkedNode,
    text: &str,
    in_equation: bool,
    fixes: &mut Vec<DelimiterFix>,
) {
    if node.kind() != SyntaxKind::Error {
        return;
    }

    let leaf = node.get().leaf_text();

    if leaf.starts_with('`') {
        let run = leaf.chars().take_while(|&ch| ch == '`').count();
        let block = run >= 3 && line_is_blank_before(text, node.range().start);

        fixes.push(DelimiterFix {
            raw_offset: close_offset(text, node.range()),
            kind: FixKind::Raw { run, block },
        });
        return;
    }

    if !in_equation && leaf.starts_with('"') {
        fixes.push(DelimiterFix {
            raw_offset: close_offset(text, node.range()),
            kind: FixKind::String,
        });
    }
}

/// Closes `/*` comments that never reach `*/`.
fn collect_block_comment_fix(node: &LinkedNode, text: &str, fixes: &mut Vec<DelimiterFix>) {
    if node.kind() != SyntaxKind::BlockComment {
        return;
    }

    if node.get().leaf_text().ends_with("*/") {
        return;
    }

    fixes.push(DelimiterFix {
        raw_offset: close_offset(text, node.range()),
        kind: FixKind::BlockComment,
    });
}

/// Where a construct's closer goes: the first blank line inside it, else its
/// end.
fn close_offset(text: &str, range: Range<usize>) -> usize {
    blank_line_start(text, range.clone()).unwrap_or(range.end)
}

/// Whether only whitespace sits between the start of the line and `offset`.
fn line_is_blank_before(text: &str, offset: usize) -> bool {
    let line_start = text[..offset].rfind('\n').map_or(0, |index| index + 1);

    text[line_start..offset].trim().is_empty()
}

/// The equation pass: math strings, bare attachments, and the closing `$`.
///
/// Inner fixes are pushed before the dollar so that a closer landing at the
/// same offset stays inside the equation.
fn collect_equation_fixes(node: &LinkedNode, text: &str, fixes: &mut Vec<DelimiterFix>) {
    let mut string_fixes = Vec::new();
    collect_string_fixes(node, text, &mut string_fixes);

    let mut attachments = Vec::new();
    collect_bare_attachments(node, &mut attachments);

    let unclosed =
        node.children().next_back().map(|child| child.kind()) != Some(SyntaxKind::Dollar);

    let mut dollar = None;

    if unclosed {
        let close = close_offset(text, node.range());

        // A quote placed right before the user's own `$` closes both the
        // string and the equation; adding a second `$` there would make the
        // trailing delimiter content.
        let covered = string_fixes
            .iter()
            .any(|fix| fix.closes_equation && fix.raw_offset <= close);

        if !covered {
            dollar = Some(close);
        }
    }

    fixes.extend(string_fixes.into_iter().map(|fix| DelimiterFix {
        raw_offset: fix.raw_offset,
        kind: FixKind::MathQuote,
    }));
    fixes.extend(attachments);

    if let Some(close) = dollar {
        fixes.push(DelimiterFix {
            raw_offset: close,
            kind: FixKind::MathDollar,
        });
    }
}

/// Adds a placeholder argument to attachments that have none.
///
/// `x_` has no subscript argument, so the parser consumes the next token as
/// the argument. In `abs((x_))` that token is the closing paren: the paren
/// nesting breaks and the equation fails with "unclosed delimiter", which
/// block removal then blanks entirely. `x_#none` attaches nothing and leaves
/// the paren where it belongs. At the end of the file the parser leaves an
/// empty error node as the missing argument, so that counts as missing too.
fn collect_bare_attachments(node: &LinkedNode, out: &mut Vec<DelimiterFix>) {
    if node.kind() == SyntaxKind::MathAttach {
        let mut operator_end = None;
        let mut operator_kind = None;
        let mut last_kind = None;
        let mut last_text = String::new();

        for child in node.children() {
            if matches!(child.kind(), SyntaxKind::Underscore | SyntaxKind::Hat) {
                operator_end = Some(child.range().end);
                operator_kind = Some(child.kind());
            }

            last_kind = Some(child.kind());
            last_text = child.get().leaf_text().to_string();
        }

        if let (Some(operator_end), Some(operator_kind)) = (operator_end, operator_kind) {
            let missing = if last_kind == Some(operator_kind) {
                true
            } else {
                last_kind == Some(SyntaxKind::MathAlignPoint)
                    || last_kind == Some(SyntaxKind::Error)
                    || (last_kind == Some(SyntaxKind::MathText)
                        && matches!(last_text.as_str(), ")" | "]" | "}" | "|"))
            };

            if missing {
                out.push(DelimiterFix {
                    raw_offset: operator_end,
                    kind: FixKind::MathAttachment,
                });
            }
        }
    }

    for child in node.children() {
        collect_bare_attachments(&child, out);
    }
}

/// A string closer found inside an equation, plus whether the character just
/// before it is the user's own `$`.
struct FoundStringFix {
    raw_offset: usize,
    closes_equation: bool,
}

fn collect_string_fixes(node: &LinkedNode, text: &str, out: &mut Vec<FoundStringFix>) {
    if node.kind().is_error() {
        let leaf = node.get().leaf_text();

        if leaf.starts_with('"')
            && let Some(offset) = string_close_offset(text, node.range())
        {
            let trimmed_end = text[..offset].trim_end().len();
            let closes_equation = trimmed_end > 0 && text[..trimmed_end].ends_with('$');
            let raw_offset = if closes_equation {
                trimmed_end - 1
            } else {
                offset
            };

            out.push(FoundStringFix {
                raw_offset,
                closes_equation,
            });
        }

        return;
    }

    for child in node.children() {
        collect_string_fixes(&child, text, out);
    }
}

/// Where an unclosed string should end: the first blank line inside `range`,
/// otherwise the end of the range.
fn string_close_offset(text: &str, range: Range<usize>) -> Option<usize> {
    if range.end > text.len() || range.start > range.end {
        return None;
    }

    Some(blank_line_start(text, range.clone()).unwrap_or(range.end))
}

/// Byte offset of the first blank line inside `range`, if any.
fn blank_line_start(text: &str, range: Range<usize>) -> Option<usize> {
    if range.end > text.len() || range.start > range.end {
        return None;
    }

    let slice = &text[range.clone()];

    let lf = slice.find("\n\n");
    let crlf = slice.find("\r\n\r\n");

    match (lf, crlf) {
        (Some(lf), Some(crlf)) => Some(range.start + lf.min(crlf)),
        (Some(offset), None) | (None, Some(offset)) => Some(range.start + offset),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::Side;

    fn repaired(text: &str) -> String {
        RawFixups::new(find_fixes(text), text.len()).repaired(text)
    }

    #[test]
    fn unclosed_dollar_closes_at_blank_line() {
        let text = "Before.\n\n$ x + y\n\nAfter paragraph.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 16,
                kind: FixKind::MathDollar,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n$ x + y$\n\nAfter paragraph.\n");
    }

    #[test]
    fn unclosed_quote_uses_the_existing_dollar() {
        let text = "Before.\n\n$ \"abc > 3 $\n\nAfter paragraph.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 20,
                kind: FixKind::MathQuote,
            }]
        );

        assert_eq!(
            repaired(text),
            "Before.\n\n$ \"abc > 3 \"$\n\nAfter paragraph.\n"
        );
    }

    #[test]
    fn unclosed_quote_without_dollar_gets_both() {
        let text = "$ \"abc";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 6,
                    kind: FixKind::MathQuote,
                },
                DelimiterFix {
                    raw_offset: 6,
                    kind: FixKind::MathDollar,
                },
            ]
        );

        assert_eq!(repaired(text), "$ \"abc\"$");
    }

    #[test]
    fn closed_equations_are_left_alone() {
        assert_eq!(find_fixes("Inline $x + y$ here.\n").len(), 0);
        assert_eq!(find_fixes("$ \"ok\" $\n").len(), 0);
    }

    #[test]
    fn bare_attachments_get_a_placeholder() {
        let text = "Before.\n\n$ abs((x_)) $\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 18,
                kind: FixKind::MathAttachment,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n$ abs((x_#none)) $\n\nAfter.\n");
    }

    #[test]
    fn superscript_attachments_get_a_placeholder() {
        let text = "$ abs(x^) $";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 8,
                kind: FixKind::MathAttachment,
            }]
        );
    }

    #[test]
    fn filled_attachments_are_left_alone() {
        assert_eq!(find_fixes("$ f(x)_1 $").len(), 0);
        assert_eq!(find_fixes("$ (a + b)^2 $").len(), 0);
    }

    #[test]
    fn lone_quote_at_eof_gets_both() {
        let text = "$ \"";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 3,
                    kind: FixKind::MathQuote,
                },
                DelimiterFix {
                    raw_offset: 3,
                    kind: FixKind::MathDollar,
                },
            ]
        );

        assert_eq!(repaired(text), "$ \"\"$");
    }

    #[test]
    fn bare_attachment_at_eof_gets_a_placeholder() {
        let text = "$ x_";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 4,
                    kind: FixKind::MathAttachment,
                },
                DelimiterFix {
                    raw_offset: 4,
                    kind: FixKind::MathDollar,
                },
            ]
        );

        assert_eq!(repaired(text), "$ x_#none$");
    }

    #[test]
    fn fixups_round_trip() {
        let text = "Before.\n\n$ x + y\n\nAfter paragraph.\n";
        let fixups = RawFixups::new(find_fixes(text), text.len());
        let map = fixups.map();

        assert!(!fixups.is_empty());
        assert_eq!(map.forward(16, Side::Before), 16);
        assert_eq!(map.forward(16, Side::After), 17);
        assert_eq!(map.backward(16), 16);
        assert_eq!(map.backward(17), 16);
        assert_eq!(map.backward(25), 24);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn unclosed_fence_gets_a_closing_fence() {
        let text = "Before.\n\n```\nlet x = 1\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 22,
                kind: FixKind::Raw {
                    run: 3,
                    block: true
                },
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n```\nlet x = 1\n```\n\nAfter.\n",);
    }

    #[test]
    fn unclosed_fence_with_language_gets_a_fence() {
        let text = "Before.\n\n```python\nx = 1\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 24,
                kind: FixKind::Raw {
                    run: 3,
                    block: true
                },
            }]
        );

        assert_eq!(
            repaired(text),
            "Before.\n\n```python\nx = 1\n```\n\nAfter.\n",
        );
    }

    #[test]
    fn long_fence_gets_a_matching_run() {
        let text = "Before.\n\n````\nlet x = 1\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 23,
                kind: FixKind::Raw {
                    run: 4,
                    block: true
                },
            }]
        );

        assert_eq!(
            repaired(text),
            "Before.\n\n````\nlet x = 1\n````\n\nAfter.\n",
        );
    }

    #[test]
    fn fence_at_eof_closes_after_the_last_line() {
        let text = "Before.\n\n```\nlet x = 1\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 23,
                kind: FixKind::Raw {
                    run: 3,
                    block: true
                },
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n```\nlet x = 1\n\n```");
    }

    #[test]
    fn unclosed_inline_raw_gets_a_backtick() {
        let text = "A `code fragment\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 16,
                kind: FixKind::Raw {
                    run: 1,
                    block: false,
                },
            }]
        );

        assert_eq!(repaired(text), "A `code fragment`\n\nAfter.\n");
    }

    #[test]
    fn unclosed_code_block_gets_a_brace() {
        let text = "Before.\n\n#{ let x = 1\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 21,
                kind: FixKind::CodeBlock,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n#{ let x = 1}\n\nAfter.\n");
    }

    #[test]
    fn unclosed_content_block_gets_a_bracket() {
        let text = "Before.\n\n#[hello\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 16,
                kind: FixKind::ContentBlock,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n#[hello]\n\nAfter.\n");
    }

    #[test]
    fn unclosed_call_gets_a_paren() {
        let text = "Before.\n\n#f(1, 2\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 16,
                kind: FixKind::Grouping,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n#f(1, 2)\n\nAfter.\n");
    }

    #[test]
    fn unclosed_array_gets_a_paren() {
        let text = "Before.\n\n#(1, 2\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 15,
                kind: FixKind::Grouping,
            }]
        );
    }

    #[test]
    fn unclosed_code_string_gets_a_quote() {
        let text = "Before.\n\n#let x = \"abc\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 22,
                kind: FixKind::String,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n#let x = \"abc\"\n\nAfter.\n",);
    }

    #[test]
    fn unclosed_block_comment_gets_a_terminator() {
        let text = "Before.\n\n/* comment\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 19,
                kind: FixKind::BlockComment,
            }]
        );

        assert_eq!(repaired(text), "Before.\n\n/* comment*/\n\nAfter.\n");
    }

    #[test]
    fn nested_closers_are_inserted_inner_first() {
        let text = "Before.\n\n#f(1, #[hello\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 22,
                    kind: FixKind::ContentBlock,
                },
                DelimiterFix {
                    raw_offset: 22,
                    kind: FixKind::Grouping,
                },
            ]
        );

        assert_eq!(repaired(text), "Before.\n\n#f(1, #[hello])\n\nAfter.\n",);
    }

    #[test]
    fn nested_string_and_paren_are_inserted_inner_first() {
        let text = "Before.\n\n#f(\"abc\n\nAfter.\n";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 16,
                    kind: FixKind::String,
                },
                DelimiterFix {
                    raw_offset: 16,
                    kind: FixKind::Grouping,
                },
            ]
        );

        assert_eq!(repaired(text), "Before.\n\n#f(\"abc\")\n\nAfter.\n",);
    }

    #[test]
    fn closed_code_constructs_are_left_alone() {
        for text in [
            "#f(1, 2)",
            "#{ 1 }",
            "#[hi]",
            "#(1, 2)",
            "#(1 + 2)",
            "#let x = \"a\"",
            "/* a */",
            "`a`",
            "```\na\n```",
            "#f(#[hi])",
        ] {
            assert_eq!(find_fixes(text).len(), 0, "{text:?}");
        }
    }

    #[test]
    fn crlf_blank_lines_close_constructs() {
        let text = "Before.\r\n\r\n#[open\r\n\r\nAfter.\r\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 17,
                kind: FixKind::ContentBlock,
            }]
        );

        assert_eq!(repaired(text), "Before.\r\n\r\n#[open]\r\n\r\nAfter.\r\n",);
    }
}
