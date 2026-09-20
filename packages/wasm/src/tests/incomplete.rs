//! Mid-typing documents: unfinished raw, code, and comment constructs must
//! render the text around them without panicking the engine.
//!
//! The repair closes a construct at the first blank line inside it (or at its
//! end), so the paragraph behind it keeps its own block. Every fixture here
//! has the shape `Before.`, the unfinished construct, then
//! `After the incomplete block.`; losing that trailing paragraph is the
//! failure these tests exist for.

use crate::{
    renderer::paged::PagedRender,
    tests::{fixtures, harness},
};

/// Fixtures whose trailing paragraph is separated by a blank line, so it must
/// keep rendering. The `_eof` and `_no_blank` variants end inside the
/// construct instead.
const TRAILING_PARAGRAPH: &[&str] = &[
    "incomplete_after_heading",
    "incomplete_array",
    "incomplete_block_comment",
    "incomplete_call",
    "incomplete_code_block",
    "incomplete_content_block",
    "incomplete_crlf",
    "incomplete_deep",
    "incomplete_fence",
    "incomplete_fence_lang",
    "incomplete_fence_long_run",
    "incomplete_in_list",
    "incomplete_inline_raw",
    "incomplete_nested",
    "incomplete_paren",
    "incomplete_string",
];

const MARKER: &str = "After the incomplete block.";

/// The marker paragraph's range in UTF-16, the space chunk ranges use.
fn marker_range(source: &str) -> (usize, usize) {
    let start = source.find(MARKER).expect("marker paragraph missing");
    let to_utf16 = |byte: usize| source[..byte].chars().map(char::len_utf16).sum::<usize>();

    (to_utf16(start), to_utf16(start + MARKER.len()))
}

fn covers(render: &PagedRender, range: (usize, usize)) -> bool {
    render
        .chunks
        .iter()
        .any(|chunk| chunk.range.start <= range.0 && chunk.range.end >= range.1)
}

/// Every unfinished construct still compiles to a document. Before the repair
/// this panicked on unclosed fences and block comments.
#[test]
fn incomplete_fixtures_render_through_recovery() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::broken() {
        if !fixture.name.starts_with("incomplete_") {
            continue;
        }

        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        assert!(
            render.document.is_some(),
            "{}: no document after recovery: {:#?}",
            fixture.name,
            render.diagnostics,
        );
    }
}

/// The paragraph after the unfinished construct keeps its own chunk. This is
/// the assertion the older suites lacked: they passed while the construct
/// swallowed and blanked everything after it.
#[test]
fn trailing_paragraph_still_renders() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for name in TRAILING_PARAGRAPH {
        let fixture = fixtures::get("broken", name);
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);
        let range = marker_range(&fixture.source);

        assert!(
            covers(&render, range),
            "{}: the trailing paragraph was swallowed: {:#?}",
            fixture.name,
            render
                .chunks
                .iter()
                .map(|chunk| chunk.range.clone())
                .collect::<Vec<_>>(),
        );
    }
}

/// The paragraph before the construct always keeps rendering.
#[test]
fn leading_paragraph_survives() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::broken() {
        if !fixture.name.starts_with("incomplete_") {
            continue;
        }

        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        assert!(
            render.chunks.iter().any(|chunk| chunk.range.start == 0),
            "{}: the leading paragraph was swallowed: {:#?}",
            fixture.name,
            render
                .chunks
                .iter()
                .map(|chunk| chunk.range.clone())
                .collect::<Vec<_>>(),
        );
    }
}

/// Compiling the same unfinished text twice is stable: the repair is
/// deterministic and the early-out restores the same pristine sources.
#[test]
fn incomplete_compiles_are_stable() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for name in TRAILING_PARAGRAPH {
        let fixture = fixtures::get("broken", name);
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let first = harness::compile(&mut state, &id, &fixture.source);
        let second = harness::compile(&mut state, &id, &fixture.source);

        let first_ranges = first
            .chunks
            .iter()
            .map(|chunk| chunk.range.clone())
            .collect::<Vec<_>>();
        let second_ranges = second
            .chunks
            .iter()
            .map(|chunk| chunk.range.clone())
            .collect::<Vec<_>>();

        assert_eq!(
            first_ranges, second_ranges,
            "{}: chunk ranges drifted between compiles",
            fixture.name,
        );
    }
}
