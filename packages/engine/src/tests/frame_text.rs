//! Page search reads visible text from the layout, not from SVG outlines.

use crate::{source::FrameText, tests::harness};

fn utf16_slice(text: &str, from: usize, to: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let end = to.min(units.len());

    String::from_utf16(&units[from.min(end)..end]).unwrap_or_default()
}

#[test]
fn frame_text_tracks_source_ranges_and_visible_content() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = "= Searchable\n\nA café sentence with *bold* text.\n\n$ alpha + x^2 $\n\n```typ\n#let value = 1\n```\n";
    let mut state = harness::state();
    let id = harness::page(&mut state, "frame-text");
    state.set_find_text(&id, true);

    let render = harness::compile_svg(&mut state, &id, source);
    let text: FrameText = state.get_source_context(&id).frame_text.clone();

    assert_eq!(text.source_hash, crate::source::source_hash(source));
    assert_eq!(render.frames.len(), text.frames.len());

    for (frame, index) in text.frames.iter().zip(&render.frames) {
        assert_eq!(frame.from, index.range.start);
        assert_eq!(frame.to, index.range.end);
    }

    let runs: Vec<_> = text.frames.iter().flat_map(|frame| &frame.runs).collect();
    let all: String = runs.iter().map(|run| run.text.as_str()).collect();

    assert!(all.contains("Searchable"), "heading text missing: {all:?}");
    assert!(all.contains("café"), "prose text missing: {all:?}");
    assert!(all.contains("value"), "code text missing: {all:?}");

    let prose = runs
        .iter()
        .find(|run| run.text.contains("café"))
        .expect("prose run");
    let prose_from = prose.glyphs.iter().find_map(|glyph| glyph.from);
    let prose_to = prose.glyphs.iter().rev().find_map(|glyph| glyph.to);
    let prose_source = utf16_slice(source, prose_from.unwrap(), prose_to.unwrap());

    assert!(
        prose_source.contains("café"),
        "prose source range missed the word: {prose_source:?}"
    );

    let accent = prose
        .glyphs
        .iter()
        .find(|glyph| utf16_slice(&prose.text, glyph.start, glyph.end) == "é")
        .expect("accent glyph");
    assert_eq!(
        utf16_slice(source, accent.from.unwrap(), accent.to.unwrap()),
        "é",
        "a glyph inside a run did not get its own source range"
    );

    let bold = runs
        .iter()
        .find(|run| run.text.contains("bold"))
        .expect("bold run");
    let bold_from = bold.glyphs.iter().find_map(|glyph| glyph.from);
    let bold_to = bold.glyphs.iter().rev().find_map(|glyph| glyph.to);
    assert_eq!(
        utf16_slice(source, bold_from.unwrap(), bold_to.unwrap()),
        "bold",
        "markup around a run leaked into its source range"
    );

    let math = runs
        .iter()
        .find(|run| run.text.contains('𝛼'))
        .expect("alpha glyph");
    let glyph = math
        .glyphs
        .iter()
        .find(|glyph| utf16_slice(&math.text, glyph.start, glyph.end).contains('𝛼'))
        .expect("alpha glyph range");
    let alpha_source = utf16_slice(source, glyph.from.unwrap(), glyph.to.unwrap());

    assert!(
        alpha_source.contains("alpha"),
        "math glyph lost its source command: {alpha_source:?}"
    );

    let code = runs
        .iter()
        .find(|run| run.text.contains("value"))
        .expect("code run");
    let code_from = code.glyphs.iter().find_map(|glyph| glyph.from);
    let code_to = code.glyphs.iter().rev().find_map(|glyph| glyph.to);
    let code_source = utf16_slice(source, code_from.unwrap(), code_to.unwrap());

    assert!(
        code_source.contains("value"),
        "code source range missed the word: {code_source:?}"
    );

    let code_glyph = code
        .glyphs
        .iter()
        .find(|glyph| utf16_slice(&code.text, glyph.start, glyph.end) == "v")
        .expect("code glyph");
    assert_eq!(
        utf16_slice(source, code_glyph.from.unwrap(), code_glyph.to.unwrap()),
        "v",
        "a code glyph lost its source offset"
    );
}

#[test]
fn frame_text_is_lazy() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "frame-text-off");
    harness::compile_svg(&mut state, &id, "Plain text");

    assert!(state.get_source_context(&id).frame_text.frames.is_empty());

    state.set_find_text(&id, true);
    harness::compile_svg(&mut state, &id, "Plain text");
    assert!(!state.get_source_context(&id).frame_text.frames.is_empty());

    state.set_find_text(&id, false);
    assert!(state.get_source_context(&id).frame_text.frames.is_empty());
}
