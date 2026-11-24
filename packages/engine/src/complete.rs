//! Completions for the app stdlib's string arguments.
//!
//! `typst_ide::autocomplete` completes expressions, field accesses, and
//! parameter names, but never the contents of a string. `#typbase.query` takes
//! its kind and filter as strings, so this pass supplies those values. It reads
//! the raw source and returns raw byte offsets, the coordinates the editor
//! already uses.
//!
//! A native `query` could expose `kind` through `CastInfo::Value` and get
//! completion from Typst's IDE, but the stdlib is a Typst module so exported
//! projects compile with plain `typst`. A native copy would fork that
//! implementation, and a parameter cast still cannot vary the filter prefixes
//! by the `kind` value.

use typst_syntax::{LinkedNode, Side, SyntaxKind, ast};

use crate::bindings::{TypstCompletion, TypstCompletionKind};

/// Query kinds from `TYPBASE_LIB`, with the summary shown in the completion
/// list. Keep in step with `parseQueryPath` in `@typbase/typing`.
const KINDS: &[(&str, &str)] = &[
    (
        "config",
        "Workspace name, home page id, and effective fonts.",
    ),
    (
        "pages",
        "All pages. Filter one page with by-id or a category with by-category.",
    ),
    ("categories", "All page categories."),
    ("daily", "Daily notes. Filter one month with by-month."),
    (
        "backlinks",
        "Pages that link the page id used as the filter.",
    ),
    ("sections", "Page sections with source text."),
    ("content", "One page's id, title, path, and text."),
    ("plugin-data", "One plugin instance's stored collections."),
];

/// Filter prefixes `parseQueryPath` understands, and the kind each one
/// belongs to. Kinds whose filter is a bare id (sections, content, backlinks,
/// plugin-data) have no static prefix to offer.
const FILTERS: &[(&str, &str, &str)] = &[
    ("pages", "by-id", "One page by id."),
    ("pages", "by-category", "Pages in one category."),
    ("daily", "by-month", "Daily notes in one YYYY-MM month."),
];

/// Which argument of `#typbase.query` the cursor is in.
#[derive(Clone, Copy)]
enum Slot {
    Kind,
    Filter,
}

/// How the selected value replaces the text at the cursor.
#[derive(Clone, Copy)]
enum Insert {
    /// Inside a closed string: replace the contents and keep the closing quote.
    Closed,
    /// Inside an unfinished string: replace the contents and close the quote.
    Open,
    /// At an empty argument: insert the value with both quotes.
    Bare,
}

/// Completions for a cursor inside `#typbase.query(...)`, or `None` when the
/// cursor is somewhere this pass does not own.
pub(crate) fn query_completions(
    root: &typst_syntax::SyntaxNode,
    cursor: usize,
) -> Option<(usize, Vec<TypstCompletion>)> {
    let linked = LinkedNode::new(root);
    let leaf = linked.leaf_at(cursor, Side::Before)?;

    // `typst_ide` already declines to complete in comments; this pass must too,
    // because a comment leaf is trivia and the slot logic below would skip it.
    if matches!(
        leaf.kind(),
        SyntaxKind::LineComment | SyntaxKind::BlockComment
    ) {
        return None;
    }

    let call = ancestor(&leaf, SyntaxKind::FuncCall)?;
    if !is_query_call(&call) {
        return None;
    }

    let args = ancestor(&leaf, SyntaxKind::Args)?;
    let kind = query_kind(&args);

    if let Some((start, closed)) = string_body(&leaf, cursor) {
        let slot = match filter_named(&leaf, &args) {
            Some(_) => Slot::Filter,
            None if first_positional(&leaf, &args) => Slot::Kind,
            None => return None,
        };
        let insert = if closed { Insert::Closed } else { Insert::Open };
        let completions = build(slot, kind.as_deref(), insert);

        return (!completions.is_empty()).then_some((start, completions));
    }

    // Empty argument slots. The previous significant leaf decides which slot
    // the cursor opens: the call's `(` for the first positional argument, or a
    // `filter:` colon for its value.
    let previous = previous_non_trivia(&leaf)?;
    let slot = if previous.kind() == SyntaxKind::LeftParen && previous.offset() == args.offset() {
        Slot::Kind
    } else if previous.kind() == SyntaxKind::Colon && is_filter_colon(&previous, &args) {
        Slot::Filter
    } else {
        return None;
    };

    // Do not insert a new quoted value when one is already being typed at the
    // cursor. `#typbase.query(|"pages")` and `filter: |"by-id"` land here.
    if let Some(next) = next_non_trivia(&leaf)
        && !matches!(next.kind(), SyntaxKind::RightParen | SyntaxKind::Comma)
    {
        return None;
    }

    let completions = build(slot, kind.as_deref(), Insert::Bare);
    (!completions.is_empty()).then_some((cursor, completions))
}

/// First ancestor of `leaf` with `kind`, including `leaf` itself.
fn ancestor<'a>(leaf: &LinkedNode<'a>, kind: SyntaxKind) -> Option<LinkedNode<'a>> {
    let mut node = Some(leaf.clone());
    while let Some(current) = node {
        if current.kind() == kind {
            return Some(current);
        }
        node = current.parent().cloned();
    }

    None
}

/// The `filter:` named argument under `args`, if the leaf is inside one.
fn filter_named<'a>(leaf: &LinkedNode<'a>, args: &LinkedNode<'a>) -> Option<LinkedNode<'a>> {
    let mut node = Some(leaf.clone());
    while let Some(current) = node {
        if current.kind() == SyntaxKind::Named {
            let named = current.get().cast::<ast::Named>()?;
            if named.name().as_str() != "filter" {
                return None;
            }

            let parent = current.parent()?;
            return (parent.kind() == SyntaxKind::Args && parent.offset() == args.offset())
                .then_some(current);
        }

        if current.kind() == SyntaxKind::Args {
            return None;
        }

        node = current.parent().cloned();
    }

    None
}

/// True when `colon` is the separator of the `filter:` argument under `args`.
fn is_filter_colon(colon: &LinkedNode, args: &LinkedNode) -> bool {
    let Some(named) = colon.parent().cloned() else {
        return false;
    };

    if named.kind() != SyntaxKind::Named {
        return false;
    }

    let parent = named.parent().cloned();
    let Some(named) = named.get().cast::<ast::Named>() else {
        return false;
    };

    named.name().as_str() == "filter"
        && parent.is_some_and(|parent| {
            parent.kind() == SyntaxKind::Args && parent.offset() == args.offset()
        })
}

/// True when `leaf` sits in the first positional argument of `args`.
fn first_positional(leaf: &LinkedNode, args: &LinkedNode) -> bool {
    let mut node = leaf.clone();
    loop {
        let Some(parent) = node.parent().cloned() else {
            return false;
        };

        if parent.kind() == SyntaxKind::Args && parent.offset() == args.offset() {
            for child in args.children() {
                if child.index() == node.index() {
                    return true;
                }

                if !child.kind().is_trivia() && child.kind() == SyntaxKind::Comma {
                    return false;
                }
            }

            return false;
        }

        node = parent;
    }
}

/// The closed or unfinished string that contains the cursor, as the offset just
/// inside its opening quote and whether it has a closing quote.
fn string_body(leaf: &LinkedNode, cursor: usize) -> Option<(usize, bool)> {
    let text = leaf.get().leaf_text();
    if !text.starts_with('"') {
        return None;
    }

    let start = leaf.offset() + 1;
    if cursor < start {
        return None;
    }

    let closed = text.len() >= 2 && text.ends_with('"');
    let end = leaf.range().end - usize::from(closed);

    (cursor <= end).then_some((start, closed))
}

/// The kind from the first positional string, when it is already written.
fn query_kind(args: &LinkedNode) -> Option<String> {
    let args = args.get().cast::<ast::Args>()?;

    match args.items().next()? {
        ast::Arg::Pos(ast::Expr::Str(value)) => Some(value.get().to_string()),
        _ => None,
    }
}

fn is_query_call(call: &LinkedNode) -> bool {
    let Some(call) = call.get().cast::<ast::FuncCall>() else {
        return false;
    };

    let ast::Expr::FieldAccess(access) = call.callee() else {
        return false;
    };

    let ast::Expr::Ident(target) = access.target() else {
        return false;
    };

    target.as_str() == "typbase" && access.field().as_str() == "query"
}

fn previous_non_trivia<'a>(leaf: &LinkedNode<'a>) -> Option<LinkedNode<'a>> {
    let mut node = Some(leaf.clone());
    while let Some(current) = node {
        if !current.kind().is_trivia() {
            return Some(current);
        }
        node = current.prev_leaf();
    }

    None
}

fn next_non_trivia<'a>(leaf: &LinkedNode<'a>) -> Option<LinkedNode<'a>> {
    let mut node = leaf.next_leaf();
    while let Some(current) = node {
        if !current.kind().is_trivia() {
            return Some(current);
        }
        node = current.next_leaf();
    }

    None
}

fn build(slot: Slot, kind: Option<&str>, insert: Insert) -> Vec<TypstCompletion> {
    match slot {
        Slot::Kind => {
            KINDS
                .iter()
                .map(|(label, detail)| completion(label, detail, insert))
                .collect()
        }
        Slot::Filter => {
            FILTERS
                .iter()
                .filter(|(filter_kind, ..)| kind.is_none_or(|kind| kind == *filter_kind))
                .map(|(filter_kind, label, detail)| {
                    let detail = if kind.is_some() {
                        (*detail).to_string()
                    } else {
                        format!("{detail} {filter_kind} queries.")
                    };
                    completion(label, &detail, insert)
                })
                .collect()
        }
    }
}

fn completion(label: &str, detail: &str, insert: Insert) -> TypstCompletion {
    let apply = match insert {
        Insert::Closed => label.to_string(),
        Insert::Open => format!("{label}\""),
        Insert::Bare => format!("\"{label}\""),
    };

    TypstCompletion {
        kind: TypstCompletionKind::Constant,
        label: label.to_string(),
        apply: Some(apply),
        detail: Some(detail.to_string()),
    }
}
