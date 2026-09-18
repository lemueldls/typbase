//! Tooltip extraction: tooltips are the per-equation frame groups the editor
//! positions under the cursor.

use serde::Serialize;

use crate::{
    renderer::paged::FrameItemsChunk,
    tests::{fixtures, harness},
};

#[derive(Debug, Serialize)]
struct TooltipSummary {
    range: [usize; 2],
    items: usize,
}

fn summarize(chunks: &[FrameItemsChunk]) -> Vec<TooltipSummary> {
    chunks
        .iter()
        .map(|chunk| TooltipSummary {
            range: [chunk.range.start, chunk.range.end],
            items: chunk.items.len(),
        })
        .collect()
}

#[test]
fn math_fixture_has_equation_tooltips() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "tooltip_math");
    let render = harness::compile(&mut state, &id, fixtures::MATH_OK);

    assert!(render.document.is_some());
    assert!(
        !render.tooltips.is_empty(),
        "no equation tooltips for {}",
        fixtures::MATH_OK,
    );

    for tooltip in &render.tooltips {
        assert!(!tooltip.items.is_empty(), "empty tooltip chunk");
    }
}

#[test]
fn tooltip_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::CLEAN.iter().chain(fixtures::BROKEN_MATH) {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let render = harness::compile(&mut state, &id, fixture.source);

        insta::assert_json_snapshot!(
            format!("{}_tooltips", fixture.name),
            summarize(&render.tooltips),
        );
    }
}
