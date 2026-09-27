//! Link extraction for the app's link index, backlinks, and graph.
//!
//! [`extract_links`] walks the Typst AST for the app's link forms:
//! `#typbase.page-link("<id>")`, `#typbase.embed("<id>")`, and
//! `#link("typbase://page/<id>")`. A target built at runtime, like
//! `#typbase.page-link(page.id)` in a query loop, comes back with an empty
//! target and `dynamic: true`: the span locates the call and the app fills the
//! real ids from a compile. Ranges are UTF-16 code units, the space CodeMirror
//! and `requestReveal` use.

use std::ops::Range;

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use typst_syntax::{
    LinkedNode, SyntaxKind,
    ast::{AstNode, FuncCall, Str},
};

use crate::flatten::utf16_offsets;

/// One link call in a page source, in UTF-16 offsets.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct LinkSpan {
    /// The link form: `"page-link"`, `"embed"`, or `"url"`.
    pub kind: String,
    /// The page reference: the id argument for `page-link` and `embed`, or the
    /// id part of a `typbase://page/<id>` URL. Empty for a dynamic call.
    pub target: String,
    /// UTF-16 range of the whole call.
    pub from: usize,
    pub to: usize,
    /// UTF-16 range of the target string's contents (inside the quotes) or of
    /// the target expression for a dynamic call.
    pub target_from: usize,
    pub target_to: usize,
    /// True when the target is computed at compile time; the index resolves
    /// the ids from a compile and this span only locates the call.
    pub dynamic: bool,
}

/// Byte ranges before the UTF-16 conversion.
struct RawLink {
    kind: &'static str,
    target: String,
    dynamic: bool,
    full: Range<usize>,
    target_range: Range<usize>,
}

/// Finds every app link call in `text`, sorted by source position.
pub fn extract_links(text: &str) -> Vec<LinkSpan> {
    let root = typst_syntax::parse(text);
    let mut raw = Vec::new();
    let mut stack = vec![LinkedNode::new(&root)];

    while let Some(node) = stack.pop() {
        if let Some(call) = node.get().cast::<FuncCall>() {
            if let Some(link) = link_call(&node, &call) {
                raw.push(link);
            }
        }
        for child in node.children() {
            stack.push(child);
        }
    }

    raw.sort_by_key(|link| link.full.start);
    to_spans(text, raw)
}

/// Classifies a call and pulls its target: a string literal resolves to the
/// target, anything else is a dynamic span the app fills from a compile.
/// `None` for anything that is not an app link (other functions, other URL
/// schemes, a call with no positional argument, an empty target).
fn link_call(node: &LinkedNode, call: &FuncCall) -> Option<RawLink> {
    let callee = call.callee().to_untyped().full_text();
    let kind = match callee.as_str() {
        "typbase.page-link" => "page-link",
        "typbase.embed" => "embed",
        "link" => "url",
        _ => return None,
    };

    let argument = first_positional(node)?;
    let (target_range, target, dynamic) = match argument.get().cast::<Str>() {
        Some(text) => {
            let value = text.get().to_string();
            let target = match kind {
                "url" => value.strip_prefix("typbase://page/")?.to_string(),
                _ => value,
            };
            if target.is_empty() {
                return None;
            }

            // The node covers the quotes; two bytes is the shortest string.
            let range = argument.range();
            (range.start + 1..range.end - 1, target, false)
        }
        None => (argument.range(), String::new(), true),
    };

    // The FuncCall node starts after the `#`; include the hash so the whole
    // written call is one reveal range.
    let mut full = node.range();
    if let Some(prev) = node.prev_sibling_with_trivia() {
        if prev.kind() == SyntaxKind::Hash && prev.range().end == full.start {
            full.start = prev.range().start;
        }
    }

    Some(RawLink {
        kind,
        target,
        dynamic,
        full,
        target_range,
    })
}

/// The first positional argument node. Named and spread arguments, the
/// argument-list delimiters, commas, trivia, and trailing content blocks are
/// skipped, so `body: "text"` cannot be mistaken for a target. `None` when
/// the call has no positional argument.
fn first_positional<'a>(node: &LinkedNode<'a>) -> Option<LinkedNode<'a>> {
    for child in node.children() {
        if child.kind() != SyntaxKind::Args {
            continue;
        }

        for item in child.children() {
            if item.kind().is_trivia()
                || matches!(
                    item.kind(),
                    SyntaxKind::Named
                        | SyntaxKind::Spread
                        | SyntaxKind::Comma
                        | SyntaxKind::LeftParen
                        | SyntaxKind::RightParen
                        | SyntaxKind::ContentBlock
                )
            {
                continue;
            }

            return Some(item);
        }
    }

    None
}

/// Converts every link's byte boundaries to UTF-16 in one sorted pass. Each
/// link's four boundaries are pushed in ascending order (the target sits
/// inside the call), and links are sorted by start, so the walk in
/// [`utf16_offsets`] never moves backwards.
fn to_spans(text: &str, links: Vec<RawLink>) -> Vec<LinkSpan> {
    let mut bytes = Vec::with_capacity(links.len() * 4);
    for link in &links {
        bytes.push(link.full.start);
        bytes.push(link.target_range.start);
        bytes.push(link.target_range.end);
        bytes.push(link.full.end);
    }

    let utf16 = utf16_offsets(text, &bytes);

    links
        .into_iter()
        .enumerate()
        .map(|(index, link)| LinkSpan {
            kind: link.kind.to_string(),
            target: link.target,
            from: utf16[index * 4],
            to: utf16[index * 4 + 3],
            target_from: utf16[index * 4 + 1],
            target_to: utf16[index * 4 + 2],
            dynamic: link.dynamic,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_every_link_form() {
        let text = concat!(
            "#typbase.page-link(\"page-a\")\n\n",
            "#typbase.embed(\"page-b\")\n\n",
            "#link(\"typbase://page/page-c\")[see]\n",
        );
        let links = extract_links(text);
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].kind, "page-link");
        assert_eq!(links[0].target, "page-a");
        assert_eq!(links[1].kind, "embed");
        assert_eq!(links[1].target, "page-b");
        assert_eq!(links[2].kind, "url");
        assert_eq!(links[2].target, "page-c");
    }

    #[test]
    fn target_range_excludes_quotes() {
        let text = "#typbase.page-link(\"page-a\", body: [A note])";
        let link = &extract_links(text)[0];
        assert_eq!(&text[link.target_from..link.target_to], "page-a");
        assert_eq!(&text[link.from..link.to], text);
    }

    #[test]
    fn ranges_are_utf16() {
        // "é" is one UTF-16 unit in two UTF-8 bytes; the emoji is two units in
        // four bytes. Offsets after them must count code units, not bytes.
        let text = "Héllo 🎉\n\n#typbase.page-link(\"page-a\")\n";
        let link = &extract_links(text)[0];
        let start = text.find('#').unwrap();
        let expected = text[..start].chars().map(char::len_utf16).sum::<usize>();
        assert_eq!(link.from, expected);

        // The app slices JS strings with these offsets, so compare through a
        // UTF-16 view rather than Rust byte slicing.
        let units: Vec<u16> = text.encode_utf16().collect();
        let target = String::from_utf16(&units[link.target_from..link.target_to]).unwrap();
        assert_eq!(target, "page-a", "target range lands on the id");
    }

    #[test]
    fn named_arguments_are_not_targets() {
        let text = "#typbase.page-link(body: \"not-a-target\", other: 1)\n";
        assert!(extract_links(text).is_empty());
    }

    #[test]
    fn dynamic_targets_keep_the_call_span() {
        let text = "#typbase.page-link(page.id)\n";
        let links = extract_links(text);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, "page-link");
        assert!(links[0].dynamic);
        assert_eq!(links[0].target, "");
        assert_eq!(&text[links[0].from..links[0].to], "#typbase.page-link(page.id)");
        assert_eq!(&text[links[0].target_from..links[0].target_to], "page.id");
    }

    #[test]
    fn dynamic_targets_cover_embed_and_url_calls() {
        let text = concat!(
            "#typbase.embed(myId)\n\n",
            "#link(base + \"/page\")\n\n",
            "#typbase.page-link(pageId, body: [x])\n",
        );
        let links = extract_links(text);
        assert_eq!(links.len(), 3);
        assert!(links.iter().all(|link| link.dynamic));
        assert_eq!(links[0].kind, "embed");
        assert_eq!(&text[links[0].target_from..links[0].target_to], "myId");
        assert_eq!(links[1].kind, "url");
        assert_eq!(&text[links[1].target_from..links[1].target_to], "base + \"/page\"");
        // A dynamic first argument beats a string in a later position.
        assert_eq!(&text[links[2].target_from..links[2].target_to], "pageId");
    }

    #[test]
    fn ignores_other_calls_and_urls() {
        let text = concat!(
            "#link(\"https://typst.app\")[external]\n",
            "#other.embed(\"page-a\")\n",
            "#typbase.query(\"pages\")\n",
        );
        assert!(extract_links(text).is_empty());
    }

    #[test]
    fn comments_and_raw_blocks_are_text() {
        let text = concat!(
            "// #typbase.page-link(\"page-a\")\n",
            "```\n#typbase.page-link(\"page-b\")\n```\n",
        );
        assert!(extract_links(text).is_empty());
    }

    #[test]
    fn links_come_back_in_source_order() {
        let text = "#typbase.embed(\"page-b\")\n\n#typbase.page-link(\"page-a\")\n";
        let links = extract_links(text);
        assert_eq!(links[0].target, "page-b");
        assert_eq!(links[1].target, "page-a");
        assert!(links[0].from < links[1].from);
    }
}
