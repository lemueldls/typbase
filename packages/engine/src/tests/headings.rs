//! The page outline reads top-level headings only. A heading inside a raw
//! block, a code block, or a content block is text, not structure.

use crate::flatten::extract_headings;

fn outline(text: &str) -> Vec<(u8, String)> {
    extract_headings(text)
        .into_iter()
        .map(|heading| (heading.level, heading.title))
        .collect()
}

#[test]
fn reads_levels_and_strips_markup() {
    let text = "\
= One
== Two *bold*
=== `code` and _emph_
";
    let headings = outline(text);
    assert_eq!(headings, vec![
        (1, "One".to_string()),
        (2, "Two bold".to_string()),
        (3, "code and emph".to_string()),
    ]);
}

#[test]
fn ignores_nested_and_escaped_headings() {
    let text = "\
= Real

#[
  = Not a heading
]

```
= Not a heading either
```

#let x = [= Also nested]
";
    assert_eq!(outline(text), vec![(1, "Real".to_string())]);
}

#[test]
fn skips_a_heading_with_no_text() {
    assert!(outline("=\n\n==\n").is_empty());
}

#[test]
fn ranges_are_utf16() {
    let text = "= 😀 Emoji\n\n== After\n";
    let headings = extract_headings(text);
    assert_eq!(headings.len(), 2);

    let first = &headings[0];
    assert_eq!(first.level, 1);
    assert_eq!(first.title, "😀 Emoji");
    assert_eq!(first.from, 0);
    // `= 😀 Emoji` is 10 UTF-16 units: marker, space, emoji (2), space, five letters.
    assert_eq!(first.to, 10);

    let second = &headings[1];
    assert_eq!(second.level, 2);
    assert_eq!(second.title, "After");
    assert_eq!(second.from, 12);
}
