//! Embedded code ranges are the editor's cue to set scripting in a monospaced
//! face. They cover the whole `#...` expression, including text that has no
//! highlight tag.

use crate::flatten::extract_code_spans;

fn ranges(text: &str) -> Vec<(usize, usize)> {
    extract_code_spans(text)
        .into_iter()
        .map(|range| (range.from, range.to))
        .collect()
}

#[test]
fn finds_inline_expression_and_statement() {
    let text = "A #x + 1 B\n\n#let y = 2\n";
    let inline = text.find("#x").unwrap();
    let statement = text.find("#let y = 2").unwrap();

    assert_eq!(ranges(text), vec![
        (inline, inline + "#x".len()),
        (statement, statement + "#let y = 2".len()),
    ]);
}

#[test]
fn covers_code_blocks() {
    let text = "#{\n  let x = 1\n}\n";
    let end = text.find('}').unwrap() + 1;
    assert_eq!(ranges(text), vec![(0, end)]);
}

#[test]
fn includes_statement_semicolon() {
    let text = "#let x = 2; after\n";
    assert_eq!(ranges(text), vec![(0, "#let x = 2;".len())]);
}

#[test]
fn ignores_hashes_in_raw_and_comments() {
    assert!(ranges("`#let x = 2`\n").is_empty());
    assert!(ranges("// #let x = 2\n").is_empty());
    assert!(ranges("/* #let x = 2 */\n").is_empty());
}

#[test]
fn folds_nested_expressions_into_the_outer_one() {
    let text = "#let a = [hello #b]\n";
    assert_eq!(ranges(text), vec![(0, text.trim_end().len())]);
}

#[test]
fn keeps_code_inside_math_separate() {
    let text = "$ #x + 1 $\n";
    let code = text.find("#x").unwrap();
    assert_eq!(ranges(text), vec![(code, code + "#x".len())]);
}

#[test]
fn ranges_are_utf16() {
    let text = "= 😀\n\n#let x = 2\n";
    let start = text.find("#let x = 2").unwrap();
    let utf16_start = text[..start].chars().map(char::len_utf16).sum::<usize>();
    let utf16_len = "#let x = 2".chars().map(char::len_utf16).sum::<usize>();

    assert_eq!(ranges(text), vec![(utf16_start, utf16_start + utf16_len)]);
}
