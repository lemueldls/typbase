//! Synth building: block discovery, wrapping, and equation ranges.

use crate::{
    source::{RenderTarget, sync_source_state},
    tests::{fixtures, harness},
};

#[test]
fn plain_source_wraps_paragraphs() {
    let fixture = fixtures::get("clean", "plain");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let result = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
    let synth = harness::render_text(&state, &id);

    assert!(!result.blocks.is_empty(), "no blocks discovered");
    assert!(
        synth.contains("Hello, *world*."),
        "raw text missing from synth:\n{synth}",
    );
    assert!(
        synth.contains("#block(stroke:0pt,width:100%)["),
        "paragraph was not wrapped:\n{synth}",
    );
    assert_eq!(result.equation_ranges.len(), 0);
}

#[test]
fn equations_are_recorded_with_dollar_bounds() {
    let fixture = fixtures::get("clean", "math_inline");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let result = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);

    assert_eq!(result.equation_ranges.len(), 2);

    for range in &result.equation_ranges {
        let text = &fixture.source[range.clone()];
        assert!(
            text.starts_with('$') && text.ends_with('$'),
            "equation range does not cover delimiters: {text:?}",
        );
    }
}

#[test]
fn structural_nodes_pass_through_unwrapped() {
    let fixture = fixtures::get("clean", "structure");
    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);

    let _ = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
    let synth = harness::render_text(&state, &id);

    assert!(
        synth.contains("#set par(justify: true)"),
        "set rule was rewritten:\n{synth}",
    );
    assert!(
        synth.contains("#let x = 1"),
        "let binding was rewritten:\n{synth}",
    );
    assert!(
        !synth.contains("#block(stroke:0pt,width:100%)[#let x"),
        "let binding was wrapped as a block:\n{synth}",
    );
}

/// A synth built twice from the same raw text must be byte-identical. This is
/// the property recovery-free rendering relies on.
#[test]
fn synth_is_deterministic() {
    for fixture in fixtures::clean() {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let _ = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
        let first = harness::render_text(&state, &id);

        let _ = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);
        let second = harness::render_text(&state, &id);

        assert_eq!(
            first, second,
            "{}: synth drifted between calls",
            fixture.name
        );
    }
}

/// Blank source lines become explicit vertical space, so the PDF and read
/// view keep the paragraph gaps the editor shows. A single line break is not
/// a blank line and adds nothing, and runs of blank lines collapse into one.
#[test]
fn blank_lines_become_vertical_space() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "synth_blank_lines");

    let _ = sync_source_state(
        &id,
        "First.\n\nSecond.\n\n\n\nThird.\n",
        "",
        RenderTarget::Svg,
        &mut state,
    );
    let result = harness::render_text(&state, &id);

    assert!(
        result.contains("#v(1.4em)"),
        "blank line missing from synth:\n{result}",
    );
    assert!(
        !result.contains("#v(2.8em)"),
        "run of blank lines did not collapse:\n{result}",
    );
    assert_eq!(
        result.matches("#v(1.4em)").count(),
        2,
        "expected one gap per block boundary:\n{result}",
    );

    let _ = sync_source_state(
        &id,
        "Line one\nline two\n",
        "",
        RenderTarget::Svg,
        &mut state,
    );
    let single = harness::render_text(&state, &id);

    assert!(
        !single.contains("#v("),
        "single line break became vertical space:\n{single}",
    );

    let _ = sync_source_state(&id, "\n\n\nFirst.\n", "", RenderTarget::Svg, &mut state);
    let leading = harness::render_text(&state, &id);

    assert!(
        !leading.contains("#v("),
        "leading blank lines added space before the first block:\n{leading}",
    );
}
