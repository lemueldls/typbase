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

    for fixture in fixtures::clean() {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

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

    for fixture in fixtures::clean().into_iter().chain(fixtures::broken()) {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);
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

    for fixture in fixtures::clean() {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        insta::assert_json_snapshot!(
            format!("clean_{}_chunks", fixture.name),
            summarize(&render.chunks),
        );
    }
}

#[test]
fn broken_partition_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::broken() {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        assert!(
            render.document.is_some(),
            "{}: recovery left the page without a document: {:#?}",
            fixture.name,
            render.diagnostics,
        );

        insta::assert_json_snapshot!(
            format!("broken_{}_chunks", fixture.name),
            summarize(&render.chunks),
        );
        insta::assert_json_snapshot!(
            format!("broken_{}_diagnostics", fixture.name),
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

/// The editor stacks chunk widgets by height and never reads their page
/// offsets, so the compiled spacing between two items only reaches the screen
/// when the upper item's chunk includes it. Without that, `list(spacing:)`
/// changes nothing visible.
#[test]
fn list_items_own_the_compiled_gap() {
    use crate::renderer::paged::items::chunk_by_items;
    use crate::source::RenderTarget;

    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = "- one\n- two\n- three\n";
    let mut state = harness::state();
    let id = harness::page(&mut state, "list_gap");
    state.resize(&id, Some(600.0), None);

    let tight = chunk_by_items(&id, source, "", RenderTarget::Svg, &mut state);
    assert_eq!(tight.chunks.len(), 3, "expected one chunk per item");

    for (chunk, next) in tight.chunks.iter().zip(tight.chunks.iter().skip(1)) {
        assert!(chunk.list_item, "item chunk lost its list flag");
        assert!(
            (chunk.y_offset + chunk.height - next.y_offset).abs() < 0.01,
            "chunk {:?} ends at {} but the next starts at {}",
            chunk.range,
            chunk.y_offset + chunk.height,
            next.y_offset,
        );
    }

    // The prelude takes the rule instead of the page source so the first
    // item's chunk is not the one a leading structural block receives.
    let loose = chunk_by_items(
        &id,
        source,
        "#set list(spacing: 1.5em)\n",
        RenderTarget::Svg,
        &mut state,
    );

    assert_eq!(loose.chunks.len(), 3, "expected one chunk per item");
    assert!(
        loose.chunks[0].height > tight.chunks[0].height + 1.0,
        "list(spacing:) did not grow the item chunk: {} vs {}",
        loose.chunks[0].height,
        tight.chunks[0].height,
    );

    // Content after the list must not stretch the last item: the trailing gap
    // belongs to the boundary, and a taller item widget would cover the space
    // before the next block.
    let followed = chunk_by_items(
        &id,
        "- one\n- two\n- three\ntext\n",
        "",
        RenderTarget::Svg,
        &mut state,
    );

    assert_eq!(followed.chunks.len(), 4, "expected the trailing paragraph");
    assert!(
        (followed.chunks[2].height - tight.chunks[2].height).abs() < 0.01,
        "the last item grew over the gap to the paragraph: {} vs {}",
        followed.chunks[2].height,
        tight.chunks[2].height,
    );
}

/// A list item is copied unwrapped, so without the line-box crop its chunk
/// starts at the glyph ink. The editor draws the source text on the line
/// baseline, so the crop has to start at the text's ascender line or the
/// render sits above the source and jumps when the item is edited.
#[test]
fn list_item_chunks_start_at_the_text_line_box() {
    use crate::renderer::paged::items::chunk_by_items;
    use crate::source::RenderTarget;
    use typst::layout::FrameItem;

    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "list_line_box");
    state.resize(&id, Some(600.0), None);

    let render = chunk_by_items(&id, "- one\n- two\n- three\n", "", RenderTarget::Svg, &mut state);

    for chunk in &render.chunks {
        assert!(chunk.list_item);

        let line_top = chunk
            .items
            .iter()
            .filter_map(|item| match &item.item {
                FrameItem::Text(text) if !text.text.trim().is_empty() => {
                    Some(item.point.y - text.font.metrics().ascender.at(text.size))
                }
                _ => None,
            })
            .min()
            .expect("item text");

        assert!(
            (chunk.y_offset - line_top.to_pt()).abs() < 0.01,
            "chunk {:?} starts at {} but its text line box starts at {}",
            chunk.range,
            chunk.y_offset,
            line_top.to_pt(),
        );
    }
}

/// The editor's syntax-highlight field rewrites the world's raw source in the
/// transaction, before the plugin's compile microtask. That must not make the
/// sync reuse the previous text: the stale blocks carry the old ranges, and a
/// replace decoration built from them hides the text that followed the block.
#[test]
fn highlight_between_compiles_keeps_frame_ranges_current() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "highlight_ranges");
    state.resize(&id, Some(600.0), None);

    let first = "One.\n";
    let second = "One.\n\nTwo.\n";

    let first_render = render_svgs_by_items(&id, first, "", &mut state);
    assert_eq!(
        first_render.frames.len(),
        1,
        "first text should make one chunk",
    );

    // Exactly what `TypstState::highlight` does on every keystroke.
    let _ = state.highlight(&id, second);

    let second_render = render_svgs_by_items(&id, second, "", &mut state);

    assert_eq!(
        second_render.frames.len(),
        2,
        "the second compile served the first text's chunks: {:?}",
        second_render
            .frames
            .iter()
            .map(|frame| frame.range.clone())
            .collect::<Vec<_>>(),
    );
    assert!(
        second_render.frames[1].range.start >= first.len(),
        "the second chunk starts inside the first text: {:?}",
        second_render.frames[1].range,
    );
}
