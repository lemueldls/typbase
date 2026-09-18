//! Synth building: block discovery, wrapping, and equation ranges.

use crate::{
    source::{RenderTarget, sync_source_state},
    tests::{fixtures, harness},
};

#[test]
fn plain_source_wraps_paragraphs() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "synth_plain");

    let result = sync_source_state(&id, fixtures::PLAIN, "", RenderTarget::Svg, &mut state);

    assert!(!result.blocks.is_empty(), "no blocks discovered");
    assert!(
        result.synth.contains("Hello, *world*."),
        "raw text missing from synth:\n{}",
        result.synth,
    );
    assert!(
        result.synth.contains("#block(stroke:0pt,width:100%)["),
        "paragraph was not wrapped:\n{}",
        result.synth,
    );
    assert_eq!(result.equation_ranges.len(), 0);
}

#[test]
fn equations_are_recorded_with_dollar_bounds() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "synth_math");

    let result = sync_source_state(&id, fixtures::MATH_OK, "", RenderTarget::Svg, &mut state);

    assert_eq!(result.equation_ranges.len(), 2);

    for range in &result.equation_ranges {
        let text = &fixtures::MATH_OK[range.clone()];
        assert!(
            text.starts_with('$') && text.ends_with('$'),
            "equation range does not cover delimiters: {text:?}",
        );
    }
}

#[test]
fn structural_nodes_pass_through_unwrapped() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "synth_structure");

    let result = sync_source_state(&id, fixtures::STRUCTURE, "", RenderTarget::Svg, &mut state);

    assert!(
        result.synth.contains("#set par(justify: true)"),
        "set rule was rewritten:\n{}",
        result.synth,
    );
    assert!(
        result.synth.contains("#let x = 1"),
        "let binding was rewritten:\n{}",
        result.synth,
    );
    assert!(
        !result
            .synth
            .contains("#block(stroke:0pt,width:100%)[#let x"),
        "let binding was wrapped as a block:\n{}",
        result.synth,
    );
}

/// A synth built twice from the same raw text must be byte-identical. This is
/// the property recovery-free rendering relies on.
#[test]
fn synth_is_deterministic() {
    for fixture in fixtures::CLEAN {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let first = sync_source_state(&id, fixture.source, "", RenderTarget::Svg, &mut state).synth;
        let second =
            sync_source_state(&id, fixture.source, "", RenderTarget::Svg, &mut state).synth;

        assert_eq!(
            first, second,
            "{}: synth drifted between calls",
            fixture.name
        );
    }
}
