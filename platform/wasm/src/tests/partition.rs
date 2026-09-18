//! Partitioning: which frame items end up in which editor chunk.
//!
//! Snapshots are JSON (insta's `assert_json_snapshot!`). They pin the editor
//! ranges and geometry of every fixture, clean and recovered.

use serde::Serialize;

use crate::{
    renderer::paged::FrameItemsChunk,
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
