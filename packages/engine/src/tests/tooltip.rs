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

    let fixture = fixtures::get("clean", "math_inline");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);
    let render = harness::compile(&mut state, &id, &fixture.source);

    assert!(render.document.is_some());
    assert!(
        !render.tooltips.is_empty(),
        "no equation tooltips for {}",
        fixture.source,
    );

    for tooltip in &render.tooltips {
        assert!(!tooltip.items.is_empty(), "empty tooltip chunk");
    }
}

/// Tooltips exist per equation the renderer groups, so the snapshot covers
/// fixtures with and without them. An empty list is the pin that a fixture
/// grew no tooltips; a repaired equation can legitimately produce none.
#[test]
fn tooltip_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let fixtures = fixtures::clean()
        .into_iter()
        .map(|fixture| ("clean", fixture))
        .chain(
            fixtures::broken()
                .into_iter()
                .map(|fixture| ("broken", fixture)),
        );

    for (group, fixture) in fixtures {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        insta::assert_json_snapshot!(
            format!("{group}_{}_tooltips", fixture.name),
            summarize(&render.tooltips),
        );
    }
}
