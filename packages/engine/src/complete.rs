//! Completions for the app stdlib's string arguments.
//!
//! `typst_ide::autocomplete` completes expressions, field accesses, and
//! parameter names, but never the contents of a string. The `typbase` stdlib
//! takes page ids, query kinds, and filters as strings, so this pass supplies
//! those values. It reads the raw source and returns raw byte offsets, the
//! coordinates the editor already uses.
//!
//! Fixed values (query kinds, filter prefixes) live here. Values that belong
//! to the workspace (page ids, categories, months, dates, plugin instances)
//! arrive through [`crate::state::TypstState::set_completion_data`], so the
//! engine does not need a copy of the workspace store.
//!
//! A native `query` could expose `kind` through `CastInfo::Value` and get
//! completion from Typst's IDE, but the stdlib is a Typst module so exported
//! projects compile with plain `typst`. A native copy would fork that
//! implementation, and a parameter cast still cannot vary the filter prefixes
//! by the `kind` value.

use serde::Deserialize;
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
    ("pages", "by-id/", "One page by id."),
    ("pages", "by-category/", "Pages in one category."),
    ("daily", "by-month/", "Daily notes in one YYYY-MM month."),
];

/// Workspace values supplied by the host for completion. Keys match
/// `workspaceCompletionData` in `apps/web/src/lib/typstCompletions.ts`.
#[derive(Debug, Default, Clone, Deserialize)]
pub(crate) struct CompletionData {
    #[serde(default)]
    pub(crate) pages: Vec<CompletionItem>,
    #[serde(default)]
    pub(crate) categories: Vec<CompletionItem>,
    #[serde(default)]
    pub(crate) months: Vec<CompletionItem>,
    #[serde(default)]
    pub(crate) dates: Vec<CompletionItem>,
    #[serde(default)]
    pub(crate) plugins: Vec<CompletionItem>,
}

/// One host value: label shown in the list, text inserted into the source, and
/// an optional detail line.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CompletionItem {
    pub(crate) label: String,
    pub(crate) value: String,
    #[serde(default)]
    pub(crate) detail: Option<String>,
}

/// The `typbase` function whose arguments are being completed.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Function {
    Query,
    PageLink,
    Embed,
}

/// Which argument of the call the cursor is in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Slot {
    /// The first positional query kind.
    Kind,
    /// The `filter:` argument of `query`.
    Filter,
    /// The first positional page id of `page-link` or `embed`.
    Page,
}

/// How the selected value replaces the text at the cursor.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Insert {
    /// Inside a closed string: replace the contents and keep the closing quote.
    Closed,
    /// Inside an unfinished string: replace the contents and close the quote.
    Open,
    /// At an empty argument: insert the value with both quotes.
    Bare,
}

/// Completions for a cursor inside `#typbase.query`, `page-link`, or `embed`,
/// or `None` when the cursor is somewhere this pass does not own.
pub(crate) fn typbase_completions(
    root: &typst_syntax::SyntaxNode,
    text: &str,
    cursor: usize,
    data: &CompletionData,
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
    let function = typbase_function(&call)?;
    let args = ancestor(&leaf, SyntaxKind::Args)?;
    let kind = match function {
        Function::Query => query_kind(&args),
        Function::PageLink | Function::Embed => None,
    };

    if let Some((start, closed)) = string_body(&leaf, cursor) {
        let slot = string_slot(&leaf, &args, function)?;
        let insert = if closed { Insert::Closed } else { Insert::Open };

        return build(slot, start, cursor, text, kind.as_deref(), insert, data);
    }

    // Empty argument slots. The previous significant leaf decides which slot
    // the cursor opens: the call's `(` for the first positional argument, or
    // a `filter:` colon for its value.
    let previous = previous_non_trivia(&leaf)?;
    let slot = if previous.kind() == SyntaxKind::LeftParen && previous.offset() == args.offset() {
        match function {
            Function::Query => Slot::Kind,
            Function::PageLink | Function::Embed => Slot::Page,
        }
    } else if previous.kind() == SyntaxKind::Colon
        && function == Function::Query
        && is_filter_colon(&previous, &args)
    {
        Slot::Filter
    } else {
        return None;
    };

    // Do not insert a new value when one is already being typed at the cursor.
    // `#typbase.page-link(|"welcome")` lands here.
    if let Some(next) = next_non_trivia(&leaf)
        && !matches!(next.kind(), SyntaxKind::RightParen | SyntaxKind::Comma)
    {
        return None;
    }

    build(
        slot,
        cursor,
        cursor,
        text,
        kind.as_deref(),
        Insert::Bare,
        data,
    )
}

fn build(
    slot: Slot,
    start: usize,
    cursor: usize,
    text: &str,
    kind: Option<&str>,
    insert: Insert,
    data: &CompletionData,
) -> Option<(usize, Vec<TypstCompletion>)> {
    let (from, completions) = match slot {
        Slot::Kind => (start, kind_completions(insert)),
        Slot::Filter => filter_completions(start, cursor, text, kind, insert, data)?,
        Slot::Page => (start, page_completions(insert, data)),
    };

    (!completions.is_empty()).then_some((from, completions))
}

fn kind_completions(insert: Insert) -> Vec<TypstCompletion> {
    KINDS
        .iter()
        .map(|(label, detail)| completion(label, detail, insert, false))
        .collect()
}

fn page_completions(insert: Insert, data: &CompletionData) -> Vec<TypstCompletion> {
    let mut completions = item_completions(&data.pages, insert);

    // `none` is a value, not a string, so it only fits the empty argument slot.
    // Inside a quote it would complete to the page id `"none"`.
    if insert == Insert::Bare {
        completions.insert(0, TypstCompletion {
            kind: TypstCompletionKind::Constant,
            label: String::from("none"),
            apply: Some(String::from("none")),
            detail: Some(String::from("No page.")),
        });
    }

    completions
}

fn filter_completions(
    start: usize,
    cursor: usize,
    text: &str,
    kind: Option<&str>,
    insert: Insert,
    data: &CompletionData,
) -> Option<(usize, Vec<TypstCompletion>)> {
    let typed = text.get(start..cursor)?;

    // Prefixed filters. Once the user has typed the slash, complete the value
    // from the host list.
    let prefixed: &[(&str, &[CompletionItem])] = match kind {
        Some("pages") => &[("by-id", &data.pages), ("by-category", &data.categories)],
        Some("daily") => &[("by-month", &data.months)],
        None => {
            &[
                ("by-id", &data.pages),
                ("by-category", &data.categories),
                ("by-month", &data.months),
            ]
        }
        _ => &[],
    };

    for (prefix, items) in prefixed {
        if let Some(rest) = typed.strip_prefix(prefix)
            && rest.starts_with('/')
        {
            let from = start + prefix.len() + 1;
            let completions = item_completions(items, insert);

            return Some((from, completions));
        }
    }

    if typed.contains('/') {
        return None;
    }

    // Filters that take a bare id or date.
    match kind {
        Some("sections" | "backlinks") => {
            return Some((start, item_completions(&data.pages, insert)));
        }
        Some("content") => {
            let mut completions = item_completions(&data.pages, insert);
            completions.extend(item_completions(&data.dates, insert));

            return Some((start, completions));
        }
        Some("plugin-data") => {
            return Some((start, item_completions(&data.plugins, insert)));
        }
        _ => {}
    }

    // Static prefixes. The snippet placeholder makes the editor reopen the
    // list at the value position after the slash.
    let completions = FILTERS
        .iter()
        .filter(|(filter_kind, ..)| kind.is_none_or(|kind| kind == *filter_kind))
        .map(|(filter_kind, label, detail)| {
            let detail = if kind.is_some() {
                (*detail).to_string()
            } else {
                format!("{detail} {filter_kind} queries.")
            };

            completion(label, &detail, insert, true)
        })
        .collect();

    Some((start, completions))
}

fn item_completions(items: &[CompletionItem], insert: Insert) -> Vec<TypstCompletion> {
    items
        .iter()
        .map(|item| {
            TypstCompletion {
                kind: TypstCompletionKind::Constant,
                label: item.label.clone(),
                apply: Some(match insert {
                    Insert::Closed => item.value.clone(),
                    Insert::Open => format!("{}\"", item.value),
                    Insert::Bare => format!("\"{}\"", item.value),
                }),
                detail: item.detail.clone(),
            }
        })
        .collect()
}

fn completion(label: &str, detail: &str, insert: Insert, snippet: bool) -> TypstCompletion {
    let placeholder = if snippet { "${}" } else { "" };

    TypstCompletion {
        kind: TypstCompletionKind::Constant,
        label: label.to_string(),
        apply: Some(match insert {
            Insert::Closed => format!("{label}{placeholder}"),
            Insert::Open => format!("{label}{placeholder}\""),
            Insert::Bare => format!("\"{label}{placeholder}\""),
        }),
        detail: Some(detail.to_string()),
    }
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

fn typbase_function(call: &LinkedNode) -> Option<Function> {
    let call = call.get().cast::<ast::FuncCall>()?;
    let ast::Expr::FieldAccess(access) = call.callee() else {
        return None;
    };

    let ast::Expr::Ident(target) = access.target() else {
        return None;
    };

    if target.as_str() != "typbase" {
        return None;
    }

    match access.field().as_str() {
        "query" => Some(Function::Query),
        "page-link" => Some(Function::PageLink),
        "embed" => Some(Function::Embed),
        _ => None,
    }
}

fn string_slot(leaf: &LinkedNode, args: &LinkedNode, function: Function) -> Option<Slot> {
    if function == Function::Query && filter_named(leaf, args).is_some() {
        return Some(Slot::Filter);
    }

    if !first_positional(leaf, args) {
        return None;
    }

    match function {
        Function::Query => Some(Slot::Kind),
        Function::PageLink | Function::Embed => Some(Slot::Page),
    }
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
