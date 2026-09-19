//! Error recovery: broken math must render a document, keep the pristine synth
//! untouched, and produce stable SVG output.

use crate::{
    renderer::paged::{items::chunk_by_items_with_blocks, svg::render_svgs_by_items},
    source::{RenderTarget, sync_source_state},
    tests::{fixtures, harness},
};

#[test]
fn broken_fixtures_render_through_recovery() {
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
            "{}: no document after recovery: {:#?}",
            fixture.name,
            render.diagnostics,
        );
    }
}

/// Every `.expect` line must show up in the diagnostics. The sidecars keep the
/// required warnings next to the source that produces them.
#[test]
fn fixture_warnings_match_their_expectations() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in fixtures::broken() {
        if fixture.expect.is_empty() {
            continue;
        }

        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = harness::compile(&mut state, &id, &fixture.source);

        for needle in &fixture.expect {
            assert!(
                render
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.message.contains(needle)),
                "{}: expected a `{needle}` warning, got {:#?}",
                fixture.name,
                render.diagnostics,
            );
        }
    }
}

/// Recovery may rewrite the render source, but never the pristine synth or
/// its mapper. IDE features read both of those between renders.
#[test]
fn recovery_keeps_pristine_synth_and_mapper() {
    for fixture in fixtures::broken() {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let synth = sync_source_state(&id, &fixture.source, "", RenderTarget::Svg, &mut state);

        let context = state.source_context_map.get(&id).unwrap();
        let before_text = context
            .synth_source(&state.world)
            .unwrap()
            .text()
            .to_string();
        let before_anchors = context.index_map.segments().to_vec();

        let context = state.source_context_map.get_mut(&id).unwrap();
        state.world.main_id = Some(context.render_id);

        let mut blocks = synth.blocks;
        let mut divergence = 0_u8;
        let _ = chunk_by_items_with_blocks(
            &mut blocks,
            &synth.equation_ranges,
            &mut divergence,
            context,
            &mut state.world,
        );

        state.world.main_id = Some(context.synth_id);

        let context = state.source_context_map.get(&id).unwrap();

        assert_eq!(
            before_text,
            context
                .synth_source(&state.world)
                .unwrap()
                .text()
                .to_string(),
            "{}: recovery mutated the pristine synth",
            fixture.name,
        );
        assert_eq!(
            before_anchors,
            context.index_map.segments().to_vec(),
            "{}: recovery mutated the pristine mapper",
            fixture.name,
        );
    }
}

/// Layout goldens for the recovered documents. These catch accidental drift
/// in partitioning, placeholder sizing, or the repair insertion point. The
/// list is curated: full SVG snapshots are large, so a fixture opts in here
/// instead of every recovery fixture paying for goldens.
const SVG_GOLDENS: &[&str] = &[
    "empty_quotes",
    "empty_sub",
    "empty_sub_call",
    "empty_sub_eof",
    "empty_sub_paren_eof",
    "unclosed_dollar",
    "unclosed_dollar_eof",
    "unclosed_quote",
    "unknown_call",
    "unknown_ident",
];

#[test]
fn recovery_svg_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for name in SVG_GOLDENS {
        let fixture = fixtures::get("broken", name);
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        let render = render_svgs_by_items(&id, &fixture.source, "", &mut state);

        assert!(!render.frames.is_empty(), "{name}: no SVG frames");

        for (index, frame) in render.frames.iter().enumerate() {
            insta::assert_snapshot!(format!("broken_{name}_frame_{index}"), frame.render.svg);
        }
    }
}
