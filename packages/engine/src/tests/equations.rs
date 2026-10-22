//! Equation ranges are the editor's cue to set math in a monospaced face.
//! They cover the whole `$...$`, including math text that has no highlight tag.

use crate::flatten::extract_equations;

fn ranges(text: &str) -> Vec<(usize, usize)> {
    extract_equations(text)
        .into_iter()
        .map(|range| (range.from, range.to))
        .collect()
}

#[test]
fn finds_inline_and_block_equations() {
    let text = "A $x + 1$ B\n\n$ y = 2 $\n";
    let equations = ranges(text);
    assert_eq!(equations.len(), 2);

    let inline = text.find("$x + 1$").unwrap();
    let block = text.find("$ y = 2 $").unwrap();
    assert_eq!(equations[0], (inline, inline + "$x + 1$".len()));
    assert_eq!(equations[1], (block, block + "$ y = 2 $".len()));
}

#[test]
fn folds_nested_equations_into_the_outer_one() {
    let text = "$ x + #f($y$) $\n";
    assert_eq!(ranges(text), vec![(0, text.trim_end().len())]);
}

#[test]
fn ignores_dollars_inside_raw() {
    assert!(ranges("`$not math$`\n").is_empty());
    assert!(ranges("```\n$also not math$\n```\n").is_empty());
}

#[test]
fn ranges_are_utf16() {
    let text = "= 😀\n\n$ α + β $\n";
    let equations = ranges(text);
    assert_eq!(equations.len(), 1);

    let byte_start = text.find('$').unwrap();
    let utf16_start = text[..byte_start].chars().map(char::len_utf16).sum::<usize>();
    assert_eq!(equations[0].0, utf16_start);
    assert_eq!(
        equations[0].1,
        utf16_start + "$ α + β $".chars().map(char::len_utf16).sum::<usize>()
    );
}
