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

/// A compile that repeats the same raw text and prelude skips the synth build
/// and restores the pristine render source, so recovery starts clean.
#[test]
fn unchanged_input_restores_the_pristine_render_source() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "early_out");
    let text = "$ notdefined + 1 $\n";

    let _ = sync_source_state(&id, text, "", RenderTarget::Svg, &mut state);
    let pristine = harness::render_text(&state, &id);

    let render = harness::compile(&mut state, &id, text);
    assert!(render.document.is_some());
    assert!(
        !state
            .source_context_map
            .get(&id)
            .unwrap()
            .marked_raw_ranges
            .is_empty(),
        "fixture did not mark anything",
    );
    assert_ne!(
        harness::render_text(&state, &id),
        pristine,
        "recovery did not rewrite the render source",
    );

    // A sync with the same raw text and prelude restores the pristine render
    // source, so the next compile starts from a clean slate.
    let _ = sync_source_state(&id, text, "", RenderTarget::Svg, &mut state);

    assert_eq!(
        harness::render_text(&state, &id),
        pristine,
        "the early-out did not restore the pristine render source",
    );
    assert!(
        state
            .source_context_map
            .get(&id)
            .unwrap()
            .marked_raw_ranges
            .is_empty(),
        "the early-out did not clear the marks",
    );
}

/// The editor's syntax-highlight field runs in the transaction, before the
/// plugin's compile microtask, and rewrites the world's raw source. The sync
/// cache keys on its own input text, not on that source, or every compile
/// after an edit serves the previous text's blocks and render source.
#[test]
fn highlight_between_syncs_does_not_hit_the_early_out() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "highlight_cache");

    let first = "Alpha.\n";
    let second = "Alpha, plus a new line of text.\n";

    let _ = sync_source_state(&id, first, "", RenderTarget::Svg, &mut state);
    let first_synth = harness::render_text(&state, &id);

    // Exactly what `TypstState::highlight` does on every keystroke.
    let _ = state.highlight(&id, second);

    let result = sync_source_state(&id, second, "", RenderTarget::Svg, &mut state);
    let second_synth = harness::render_text(&state, &id);

    assert_ne!(
        first_synth, second_synth,
        "the second sync reused the first text's synth",
    );
    assert!(
        second_synth.contains("plus a new line of text"),
        "the synth does not contain the new text:\n{second_synth}",
    );
    assert_eq!(result.blocks.len(), 1);
    assert_eq!(
        result.blocks[0].range.end,
        second.len() - 1,
        "block range still describes the old text",
    );
}

/// The prelude carries the pane width, theme, fonts, and text size, so any of
/// those changing must rebuild instead of hitting the early-out.
#[test]
fn prelude_changes_rebuild_the_synth() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "prelude_change");

    let _ = sync_source_state(&id, "Hello.\n", "", RenderTarget::Svg, &mut state);
    let before = harness::render_text(&state, &id);

    let _ = sync_source_state(
        &id,
        "Hello.\n",
        "#set text(size: 8pt)\n",
        RenderTarget::Svg,
        &mut state,
    );
    let after = harness::render_text(&state, &id);
    assert_ne!(before, after, "a caller prelude change was cached");

    state.resize(&id, Some(400.0), None);
    let _ = sync_source_state(&id, "Hello.\n", "", RenderTarget::Svg, &mut state);
    assert_ne!(
        harness::render_text(&state, &id),
        after,
        "a pane width change was cached",
    );
}

/// Blank source lines open a paragraph break through the block wrappers, not
/// through generated vertical space: every top-level block gets the wrapper's
/// own `above`/`below`, so gaps do not change with what a block contains.
#[test]
fn blank_lines_add_no_generated_spacing() {
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
        !result.contains("#v("),
        "blank lines generated vertical space:\n{result}",
    );
    assert_eq!(
        result.matches("#block(stroke:0pt,width:100%)[").count(),
        3,
        "blank lines merged blocks instead of separating them:\n{result}",
    );
    assert!(
        result.contains("]\n#block(stroke:0pt,width:100%)["),
        "blocks are not separated by newlines:\n{result}",
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
