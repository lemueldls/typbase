//! Tooltip extraction: tooltips are the per-equation frame groups the editor
//! positions under the cursor.

use serde::Serialize;

use crate::{
    renderer::paged::FrameItemsChunk,
    source::{RenderTarget, sync_source_state},
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

/// An equation's overlay is built from the synth's AST ranges, so its range is
/// the equation's own text: the `$` delimiters included, and nothing past them.
/// The editor matches the cursor against this range, so a wider range would pop
/// the overlay up over the prose beside the equation, and a narrower one would
/// miss a cursor resting on a delimiter.
///
/// The fixture is ASCII, so its byte offsets are its UTF-16 offsets.
#[test]
fn equation_tooltips_are_exactly_the_equation() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let fixture = fixtures::get("clean", "math_nested");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let synth = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
    let render = harness::compile(&mut state, &id, &fixture.source);

    assert_eq!(render.tooltips.len(), synth.equation_ranges.len());

    let ranges: Vec<_> = render.tooltips.iter().map(|t| &t.range).collect();
    for equation in &synth.equation_ranges {
        let source = &fixture.source[equation.clone()];
        assert!(
            ranges.contains(&equation),
            "no overlay is exactly {:?} (got {ranges:?})",
            source,
        );
    }
}

/// One equation is one overlay. A nested introspectable element used to open a
/// second bucket in the tag stack, which split the equation in two and left the
/// editor rendering whichever half it found first.
#[test]
fn a_nested_introspectable_element_keeps_one_overlay() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let fixture = fixtures::get("clean", "math_nested");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let render = harness::compile(&mut state, &id, &fixture.source);

    let nested = fixture.source.find("#strong").expect("fixture holds the nested element");
    let matching: Vec<_> = render
        .tooltips
        .iter()
        .filter(|tooltip| {
            let text = &fixture.source[tooltip.range.start..tooltip.range.end];
            text.contains("#strong")
        })
        .collect();

    assert_eq!(
        matching.len(),
        1,
        "the equation with a nested element produced {} overlays",
        matching.len(),
    );
    assert!(
        matching[0].range.start <= nested && nested < matching[0].range.end,
        "the overlay does not cover the nested element: {:?}",
        matching[0].range,
    );
}

/// A `let`-bound equation renders at every use, so its tag span points at the
/// definition while the items sit at the use. Folding item ranges against that
/// span produced one range covering the definition and every use, which made
/// the overlay pop up over whatever text lay between them.
#[test]
fn a_let_bound_equation_anchors_at_its_definition() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = String::from(
        "#let xn = $(x_n)_(n>=0)$\n\nmiddle\n\n$ xn->l quad \"for some\" l in RR $\n",
    );
    let mut state = harness::state();
    let id = harness::page(&mut state, "let_bound_equation");
    let render = harness::compile(&mut state, &id, &source);

    let between = source.find("middle").expect("fixture has the gap");
    let shows_over_gap = render
        .tooltips
        .iter()
        .any(|tooltip| tooltip.range.start <= between && between < tooltip.range.end);

    assert!(
        !shows_over_gap,
        "an overlay covers the text between the definition and the use: {:#?}",
        render
            .tooltips
            .iter()
            .map(|t| &source[t.range.start..t.range.end])
            .collect::<Vec<_>>(),
    );
}

/// The editor shows one equation overlay at a time, so a caret narrows the work
/// to that equation. Rendering every equation on every keystroke is what made a
/// math-heavy note cost several times a prose note of the same length.
#[test]
fn a_caret_renders_only_the_equation_under_it() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let fixture = fixtures::get("clean", "math_nested");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let synth = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
    let every = synth.equation_ranges.len();
    assert!(every > 1, "fixture needs several equations");

    // A caret inside the second equation, in the editor's raw UTF-16 offsets.
    let target = synth.equation_ranges[1].clone();
    let caret = {
        let context = state.source_context_map.get(&id).unwrap();
        let byte = context.map_repaired_to_raw(target.start);
        let lines = context.raw_source(&state.world).unwrap().lines();
        lines.byte_to_utf16(byte).unwrap()
    };

    let focused = crate::renderer::paged::items::chunk_by_items(
        &id,
        &fixture.source,
        "",
        Some(caret),
        RenderTarget::Svg,
        &mut state,
    );

    assert_eq!(
        focused.tooltips.len(),
        1,
        "a caret inside one equation rendered {} overlays",
        focused.tooltips.len(),
    );
    let overlay = focused.tooltips[0].range.clone();
    assert!(
        overlay.start <= target.start && target.end <= overlay.end,
        "the overlay does not cover the equation under the caret: {overlay:?} vs {target:?}",
    );

    // Without a focus, every equation still gets an overlay.
    let all = crate::renderer::paged::items::chunk_by_items(
        &id,
        &fixture.source,
        "",
        None,
        RenderTarget::Svg,
        &mut state,
    );
    assert_eq!(all.tooltips.len(), every, "no focus should build every equation");
}

/// A `let`-bound equation is laid out at each use, and the items it produces
/// carry the spans of its *definition*. Grouping items by source range therefore
/// filed them under the definition and left the equation doing the using with an
/// overlay missing that content, so the popup showed `sum_(k=0)^n` and then a gap.
///
/// The overlay is drawn from what the tag stack saw, so the popup for the bound
/// form comes out identical to the popup for the same math written in place.
///
/// The binding itself gets no popup. Nothing is rendered at the definition, so an
/// overlay anchored there would show one arbitrary use of it.
#[test]
fn a_let_bound_equation_is_drawn_inside_the_equation_that_uses_it() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let overlay_of = |source: &str, name: &str| {
        let mut state = harness::state();
        let id = harness::page(&mut state, name);

        let render = crate::renderer::paged::svg::render_svgs_by_items(&id, source, "", None, &mut state);

        assert_eq!(
            render.tooltips.len(),
            1,
            "{name}: {} overlays, expected the one equation that is on the page",
            render.tooltips.len(),
        );

        let tooltip = &render.tooltips[0];

        tooltip.render.svg.clone()
    };

    let inline = overlay_of("$ sum_(k=0)^n (x_n)_(n>=0) $\n", "inline_math");
    let bound = overlay_of(
        "#let xn = $(x_n)_(n>=0)$\n\n$ sum_(k=0)^n xn $\n",
        "bound_math",
    );

    assert_eq!(
        bound, inline,
        "the popup for a bound equation differs from the same math written in place",
    );
}

/// The binding is where the math is written but nothing is rendered there, so no
/// overlay may be anchored to it. Two uses each get their own complete popup
/// rather than sharing one that absorbed both.
#[test]
fn each_use_of_a_binding_gets_its_own_overlay() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let source = String::from("#let xn = $(x_n)_(n>=0)$\n\n$ xn $\n\n$ 2 xn $\n");
    let mut state = harness::state();
    let id = harness::page(&mut state, "shared_binding");

    let render = crate::renderer::paged::svg::render_svgs_by_items(&id, &source, "", None, &mut state);

    let ranges: Vec<_> = render
        .tooltips
        .iter()
        .map(|tooltip| &source[tooltip.range.start..tooltip.range.end])
        .collect();

    assert_eq!(ranges, ["$ xn $", "$ 2 xn $"], "one popup per use site");

    // The binding spans the first nine bytes of the note. Nothing may be anchored
    // there, or the popup would appear while the user is editing the `let`.
    let definition = 0..source.find("$ xn $").unwrap();
    for tooltip in &render.tooltips {
        assert!(
            tooltip.range.start >= definition.end || tooltip.range.end <= definition.start,
            "an overlay covers the binding: {:?}",
            &source[tooltip.range.start..tooltip.range.end],
        );
    }
}

/// Tooltips exist per equation the renderer groups, so the snapshot covers
/// fixtures with and without them. An empty list is the pin that a fixture
/// grew no tooltips. A repaired equation can legitimately produce none.
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
