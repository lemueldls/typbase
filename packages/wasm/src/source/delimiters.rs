//! Delimiter repair for the render source.
//!
//! A missing `$` or math string quote makes the parser swallow the rest of the
//! document and the compile fails with "unclosed delimiter" no matter how many
//! blocks get blanked: blanking the block that holds the error removes the
//! text the user is trying to write. The fix is to close the delimiter.
//!
//! The repair runs on the raw text before the render synth is built, so the
//! block structure matches what the user sees after the fix (the paragraph
//! after an unclosed equation is a paragraph, not part of the equation).
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

/// A delimiter inserted into the repaired source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DelimiterFix {
    /// Byte offset in the raw source where `insertion` goes.
    pub raw_offset: usize,
    /// The closing token to insert.
    pub insertion: &'static str,
}

/// Insertion points from raw to repaired text, plus the offset map they imply.
#[derive(Debug, Default, Clone)]
pub struct RawFixups {
    /// Sorted by raw offset; at equal offsets quotes come before dollars so
    /// `"$` stays in that order in the repaired text.
    fixes: Vec<DelimiterFix>,
    /// Raw to repaired offsets, built from the fix list.
    map: SourceMap,
}

impl RawFixups {
    #[must_use]
    pub fn new(mut fixes: Vec<DelimiterFix>, from_len: usize) -> Self {
        fixes.sort_by_key(|fix| (fix.raw_offset, insertion_rank(fix.insertion)));
        fixes.dedup();

        let insertions = fixes
            .iter()
            .map(|fix| (fix.raw_offset, fix.insertion))
            .collect::<Vec<_>>();
        let map = SourceMap::from_insertions(from_len, &insertions, SegmentKind::Fixup);

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
            out.push_str(fix.insertion);
        }

        out.push_str(&raw[cursor..]);
        out
    }

    fn total_len(&self) -> usize {
        self.fixes.iter().map(|fix| fix.insertion.len()).sum()
    }
}

/// Quotes sort before dollars at equal offsets: inserting `"` first leaves
/// `"$` in the repaired text, which closes the string and then the equation.
fn insertion_rank(insertion: &str) -> u8 {
    u8::from(insertion != "\"")
}

/// Reads the raw text and returns the closers it is missing.
///
/// Only errors that de-render the whole document are repaired: unclosed
/// equations (`$`), unclosed math strings (`"`). Unclosed parens and other
/// grouping tokens inside math already render as text in Typst 0.15.
#[must_use]
pub fn find_fixes(text: &str) -> Vec<DelimiterFix> {
    let root = typst_syntax::parse(text);
    let mut fixes = Vec::new();

    walk(&LinkedNode::new(&root), text, &mut fixes);

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
                message: match fix.insertion {
                    "\"" => String::from("unclosed math string; inserted a closing `\"`"),
                    "#none" => String::from("empty math attachment; inserted `#none`"),
                    _ => String::from("unclosed math equation; inserted a closing `$`"),
                },
                hints: Box::default(),
            }
        })
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

fn walk(node: &LinkedNode, text: &str, fixes: &mut Vec<DelimiterFix>) {
    if node.kind() == SyntaxKind::Equation {
        let unclosed =
            node.children().next_back().map(|child| child.kind()) != Some(SyntaxKind::Dollar);

        let mut string_fixes = Vec::new();
        collect_string_fixes(node, text, &mut string_fixes);

        if unclosed {
            let close = blank_line_start(text, node.range()).unwrap_or_else(|| node.range().end);

            // A quote placed right before the user's own `$` closes both the
            // string and the equation; adding a second `$` there would make
            // the trailing delimiter content.
            let covered = string_fixes
                .iter()
                .any(|fix| fix.closes_equation && fix.raw_offset <= close);

            if !covered {
                fixes.push(DelimiterFix {
                    raw_offset: close,
                    insertion: "$",
                });
            }
        }

        fixes.extend(string_fixes.into_iter().map(|fix| DelimiterFix {
            raw_offset: fix.raw_offset,
            insertion: "\"",
        }));

        collect_bare_attachments(node, fixes);

        return;
    }

    for child in node.children() {
        walk(&child, text, fixes);
    }
}

/// Adds a placeholder argument to attachments that have none.
///
/// `x_` has no subscript argument, so the parser consumes the next token as
/// the argument. In `abs((x_))` that token is the closing paren: the paren
/// nesting breaks and the equation fails with "unclosed delimiter", which
/// block removal then blanks entirely. `x_#none` attaches nothing and leaves
/// the paren where it belongs.
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
                    || (last_kind == Some(SyntaxKind::MathText)
                        && matches!(last_text.as_str(), ")" | "]" | "}" | "|"))
            };

            if missing {
                out.push(DelimiterFix {
                    raw_offset: operator_end,
                    insertion: "#none",
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
            && leaf.len() > 1
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

    #[test]
    fn unclosed_dollar_closes_at_blank_line() {
        let text = "Before.\n\n$ x + y\n\nAfter paragraph.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 16,
                insertion: "$",
            }]
        );

        let fixed = RawFixups::new(find_fixes(text), text.len()).repaired(text);
        assert_eq!(fixed, "Before.\n\n$ x + y$\n\nAfter paragraph.\n");
    }

    #[test]
    fn unclosed_quote_uses_the_existing_dollar() {
        let text = "Before.\n\n$ \"abc > 3 $\n\nAfter paragraph.\n";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 20,
                insertion: "\"",
            }]
        );

        let fixed = RawFixups::new(find_fixes(text), text.len()).repaired(text);
        assert_eq!(fixed, "Before.\n\n$ \"abc > 3 \"$\n\nAfter paragraph.\n");
    }

    #[test]
    fn unclosed_quote_without_dollar_gets_both() {
        let text = "$ \"abc";

        assert_eq!(
            find_fixes(text),
            vec![
                DelimiterFix {
                    raw_offset: 6,
                    insertion: "\""
                },
                DelimiterFix {
                    raw_offset: 6,
                    insertion: "$"
                },
            ]
        );

        let fixed = RawFixups::new(find_fixes(text), text.len()).repaired(text);
        assert_eq!(fixed, "$ \"abc\"$");
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
                insertion: "#none",
            }]
        );

        let fixed = RawFixups::new(find_fixes(text), text.len()).repaired(text);
        assert_eq!(fixed, "Before.\n\n$ abs((x_#none)) $\n\nAfter.\n");
    }

    #[test]
    fn superscript_attachments_get_a_placeholder() {
        let text = "$ abs(x^) $";

        assert_eq!(
            find_fixes(text),
            vec![DelimiterFix {
                raw_offset: 8,
                insertion: "#none",
            }]
        );
    }

    #[test]
    fn filled_attachments_are_left_alone() {
        assert_eq!(find_fixes("$ f(x)_1 $").len(), 0);
        assert_eq!(find_fixes("$ (a + b)^2 $").len(), 0);
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
}
