//! Notebook cell extraction: attributes, headings, and what must not be one.

use crate::flatten::extract_cells;

/// Cell kinds in source order, for the readable assertions below.
fn kinds(text: &str) -> Vec<String> {
    extract_cells(text).into_iter().map(|cell| cell.kind).collect()
}

/// The text of each cell's content, so a swallowed line shows up as a failure.
fn contents(text: &str) -> Vec<String> {
    extract_cells(text)
        .into_iter()
        .map(|cell| {
            text.get(cell.content_start..cell.content_end)
                .unwrap_or_default()
                .trim()
                .to_string()
        })
        .collect()
}

#[test]
fn a_document_without_boundaries_is_one_prose_cell() {
    let text = "= Title\n\nBody.\n";

    assert_eq!(kinds(text), vec!["prose"]);
    assert_eq!(contents(text), vec!["= Title\n\nBody."]);
}

/// A top-level heading starts a cell, so a plain document reads as a notebook
/// without being rewritten.
#[test]
fn a_heading_starts_a_cell() {
    let text = "= First\n\nOne.\n\n= Second\n\nTwo.\n";

    assert_eq!(kinds(text), vec!["prose", "prose"]);
    assert_eq!(contents(text), vec!["= First\n\nOne.", "= Second\n\nTwo."]);
}

#[test]
fn an_attribute_line_starts_a_cell() {
    let text = "//% kind=code\n#let x = 1\n\nTail.\n";

    assert_eq!(kinds(text), vec!["code"]);
    assert_eq!(contents(text), vec!["#let x = 1\n\nTail."]);
}

#[test]
fn a_bare_attribute_line_means_prose() {
    assert_eq!(kinds("//%\nBody.\n"), vec!["prose"]);
    assert_eq!(contents("//%\nBody.\n"), vec!["Body."]);
}

#[test]
fn every_kind_is_read() {
    assert_eq!(kinds("//% kind=prose\nx\n"), vec!["prose"]);
    assert_eq!(kinds("//% kind=code\nx\n"), vec!["code"]);
    assert_eq!(kinds("//% kind=log\nx\n"), vec!["log"]);
    assert_eq!(kinds("//% kind=hidden\nx\n"), vec!["hidden"]);

    // Case and field order do not matter.
    assert_eq!(kinds("//% KIND=CODE\nx\n"), vec!["code"]);
    assert_eq!(kinds("//% name=setup kind=code\nx\n"), vec!["code"]);
}

#[test]
fn a_name_is_carried_through() {
    let cells = extract_cells("//% name=setup kind=hidden\n#set text(size: 10pt)\n");

    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].name.as_deref(), Some("setup"));
    assert_eq!(cells[0].kind, "hidden");
}

/// An unknown kind is a plain comment, so a typo never silently changes how the
/// cell renders and the next attribute still splits the page.
#[test]
fn an_unknown_kind_is_not_an_attribute() {
    let text = "//% kind=prose\nA.\n\n//% kind=nope\nB.\n\n//% kind=code\n#let x = 1\n";

    assert_eq!(kinds(text), vec!["prose", "code"]);
    assert_eq!(contents(text), vec!["A.\n\n//% kind=nope\nB.", "#let x = 1"]);
}

#[test]
fn an_unknown_field_is_not_an_attribute() {
    assert_eq!(kinds("//% kind=code lang=python\nx\n"), vec!["prose"]);
}

/// An attribute sharing its line with content is not an attribute: the cell's
/// attribute range starts at the line, so the heading would land inside it and
/// disappear when the kind is rewritten.
#[test]
fn an_attribute_mid_line_is_not_an_attribute() {
    let text = "= Title //%\n\nBody.\n";

    assert_eq!(kinds(text), vec!["prose"]);
    assert_eq!(contents(text), vec!["= Title //%\n\nBody."]);
}

#[test]
fn an_indented_attribute_is_an_attribute() {
    let text = "  //% kind=code\n#let x = 1\n";

    assert_eq!(kinds(text), vec!["code"]);
    assert_eq!(contents(text), vec!["#let x = 1"]);
}

#[test]
fn content_above_the_first_boundary_is_a_cell_of_its_own() {
    let text = "#let preamble = 1\n\n//% kind=code\nBody.\n";

    assert_eq!(kinds(text), vec!["prose", "code"]);
    assert_eq!(contents(text), vec!["#let preamble = 1", "Body."]);
}

#[test]
fn trailing_blank_lines_belong_to_the_gap_not_the_cell() {
    let text = "//% kind=code\nBody.\n\n\n//% kind=code\nTail.\n";

    assert_eq!(contents(text), vec!["Body.", "Tail."]);
}

/// A cell that began at a heading has no attribute line, so the header has
/// nothing to replace.
#[test]
fn a_heading_cell_has_no_attribute_range() {
    let text = "= Title\n\nBody.\n";
    let cells = extract_cells(text);

    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].marker_start, cells[0].marker_end);
    assert_eq!(cells[0].content_start, 0);
}

/// An attribute line inside a raw block is code, not a boundary: the raw
/// block's text belongs to the cell that contains it.
#[test]
fn an_attribute_inside_a_raw_block_stays_text() {
    let text = "```\n//% kind=code\n```\n";

    assert_eq!(kinds(text), vec!["prose"]);
    assert_eq!(contents(text), vec!["```\n//% kind=code\n```"]);
}

/// The old marker is still read, so an existing notebook keeps its cells after
/// the syntax change. `//%` is checked after `// %%`, or the two would overlap.
#[test]
fn the_old_marker_still_reads() {
    assert_eq!(kinds("// %%\nBody.\n"), vec!["prose"]);
    assert_eq!(kinds("// %% [code]\n#let x = 1\n"), vec!["code"]);
    assert_eq!(kinds("//% kind=code\n#let x = 1\n"), vec!["code"]);
    assert_eq!(kinds("// %% [markup]\nBody.\n"), vec!["prose"]);
}

/// Ranges are UTF-16, because CodeMirror positions are.
#[test]
fn cell_ranges_are_utf16() {
    let text = "😀\n\n//% kind=code\n#let x = 1\n";
    let cells = extract_cells(text);
    assert_eq!(cells.len(), 2);

    let offset = text.rfind("//%").unwrap() + "//% kind=code\n".len();
    let expected = text[..offset].chars().map(char::len_utf16).sum::<usize>();
    assert_eq!(cells[1].content_start, expected);
    assert_eq!(cells[1].content_end, expected + "#let x = 1".len());
}