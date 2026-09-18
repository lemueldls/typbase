//! Partitioning: which frame items end up in which editor chunk.
//!
//! Snapshots are JSON (insta's `assert_json_snapshot!`). They pin the editor
//! ranges and geometry of every fixture, clean and recovered.

use serde::Serialize;

use crate::{
    renderer::paged::{FrameItemsChunk, svg::render_svgs_by_items},
    tests::{fixtures, harness},
};

#[derive(Debug, Serialize)]
struct ChunkSummary {
    range: [usize; 2],
    items: usize,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
}

fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn summarize(chunks: &[FrameItemsChunk]) -> Vec<ChunkSummary> {
    chunks
        .iter()
        .map(|chunk| ChunkSummary {
            range: [chunk.range.start, chunk.range.end],
            items: chunk.items.len(),
            width: round(chunk.width),
            height: round(chunk.height),
            x: round(chunk.x_offset),
            y: round(chunk.y_offset),
        })
        .collect()
}

#[test]
fn clean_fixtures_render_without_diagnostics() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::CLEAN {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let render = harness::compile(&mut state, &id, fixture.source);

        assert!(
            render.document.is_some(),
            "{}: clean fixture failed to render: {:#?}",
            fixture.name,
            render.diagnostics,
        );
        assert!(!render.chunks.is_empty(), "{}: no chunks", fixture.name);
        assert!(
            render.diagnostics.is_empty(),
            "{}: unexpected diagnostics: {:#?}",
            fixture.name,
            render.diagnostics,
        );
    }
}

/// Chunk ranges must stay inside the raw source and be non-empty. The tooltip
/// chunks follow the same rule.
#[test]
fn chunk_ranges_are_in_source() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::CLEAN.iter().chain(fixtures::BROKEN_MATH) {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let render = harness::compile(&mut state, &id, fixture.source);
        let raw_len_utf16 = fixture.source.chars().map(char::len_utf16).sum::<usize>();

        for chunk in render.chunks.iter().chain(render.tooltips.iter()) {
            assert!(
                chunk.range.start <= chunk.range.end && chunk.range.end <= raw_len_utf16,
                "{}: chunk range {:?} outside 0..{raw_len_utf16}",
                fixture.name,
                chunk.range,
            );
        }
    }
}

#[test]
fn clean_partition_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::CLEAN {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let render = harness::compile(&mut state, &id, fixture.source);

        insta::assert_json_snapshot!(
            format!("clean_{}_chunks", fixture.name),
            summarize(&render.chunks),
        );
    }
}

#[test]
fn recovery_partition_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::BROKEN_MATH {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let render = harness::compile(&mut state, &id, fixture.source);

        assert!(
            render.document.is_some(),
            "{}: recovery left the page without a document: {:#?}",
            fixture.name,
            render.diagnostics,
        );

        insta::assert_json_snapshot!(
            format!("recovery_{}_chunks", fixture.name),
            summarize(&render.chunks),
        );
        insta::assert_json_snapshot!(
            format!("recovery_{}_diagnostics", fixture.name),
            render.diagnostics,
        );
    }
}

/// A generated decoration with no span of its own (the underline from
/// `#show link:underline`) must stay in the chunk of the text it decorates,
/// not leak into the next inline item, where it would be drawn outside the
/// frame and clipped.
#[test]
fn link_underline_stays_with_its_item() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = "- #link(\"https://example.com\")[one]\n- two\n";
    let mut state = harness::state();
    let id = harness::page(&mut state, "link_underline");
    state.resize(&id, Some(600.0), None);

    let render = render_svgs_by_items(&id, source, "", &mut state);
    assert!(render.frames.len() >= 2, "expected two item chunks");

    let underlined = |svg: &str| svg.contains("stroke-width=\"0.8\"");

    let link = render
        .frames
        .iter()
        .find(|frame| frame.range.start == 0)
        .expect("link chunk missing");
    assert!(
        underlined(&link.render.svg),
        "link underline missing from its own chunk",
    );

    for frame in render.frames.iter().filter(|frame| frame.range.start != 0) {
        assert!(
            !underlined(&frame.render.svg),
            "link underline leaked into {:?}",
            frame.range,
        );
    }
}

/// List markers are generated text with no span of their own. Each one must
/// land in its own item's chunk, or the first item renders without a bullet.
#[test]
fn list_markers_stay_with_their_items() {
    use crate::renderer::paged::items::chunk_by_items;
    use crate::source::RenderTarget;
    use typst::layout::FrameItem;

    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = "test\n\n- one\n- two \n";
    let mut state = harness::state();
    let id = harness::page(&mut state, "list_markers");
    state.resize(&id, Some(600.0), None);

    let render = chunk_by_items(&id, source, "", RenderTarget::Svg, &mut state);

    let texts = |chunk: &FrameItemsChunk| {
        chunk
            .items
            .iter()
            .filter_map(|item| match &item.item {
                FrameItem::Text(text) => Some(text.text.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
    };

    let first = render
        .chunks
        .iter()
        .find(|chunk| chunk.range.start == 6)
        .expect("first item chunk missing");
    let first_texts = texts(first);
    assert!(
        first_texts.iter().any(|text| text == "•"),
        "first item lost its marker: {first_texts:?}",
    );
    assert!(
        first_texts.iter().any(|text| text == "one"),
        "first item lost its text: {first_texts:?}",
    );
    assert!(
        !first_texts.iter().any(|text| text == "- one"),
        "list marker parsed as plain text: {first_texts:?}",
    );
}
