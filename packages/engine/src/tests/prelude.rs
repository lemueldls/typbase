//! The app stdlib's call shapes and rendered output.

use typst::layout::FrameItem;

use crate::tests::harness;

/// A page link takes its text as a trailing content block or the named `body`,
/// and falls back to the target page's title when neither is given.
#[test]
fn page_link_accepts_a_trailing_body() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "page_link_body");
    let query = state.create_file_id("/typbase/query/pages/by-id/target.json");
    state.insert_file(&query, br#"{"title":"Target"}"#.to_vec());

    let render = harness::compile(
        &mut state,
        &id,
        concat!(
            "#typbase.page-link(\"target\")[Intro]\n\n",
            "#typbase.page-link(\"target\")\n\n",
            "#typbase.page-link(\"target\", body: [Named])\n",
        ),
    );

    assert!(
        render.diagnostics.is_empty(),
        "unexpected diagnostics: {:#?}",
        render.diagnostics,
    );

    let text = render
        .chunks
        .iter()
        .flat_map(|chunk| &chunk.items)
        .filter_map(|item| {
            match &item.item {
                FrameItem::Text(text) => Some(text.text.as_str()),
                _ => None,
            }
        })
        .collect::<String>();

    assert!(text.contains("Intro"), "trailing body missing: {text:?}");
    assert!(text.contains("Named"), "named body missing: {text:?}");
    assert!(text.contains("Target"), "title fallback missing: {text:?}");
}
