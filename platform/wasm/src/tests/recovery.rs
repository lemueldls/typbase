//! Error recovery: broken math must render a document, keep the pristine synth
//! untouched, and produce stable SVG output.

use crate::{
    renderer::paged::{items::chunk_by_items_with_blocks, svg::render_svgs_by_items},
    source::{RenderTarget, sync_source_state},
    tests::{fixtures, harness},
};

#[test]
fn broken_math_renders_through_recovery() {
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
            "{}: no document after recovery: {:#?}",
            fixture.name,
            render.diagnostics,
        );
        assert!(
            !render.chunks.is_empty(),
            "{}: no chunks after recovery",
            fixture.name,
        );
    }
}

/// Unclosed `$`, math strings, and empty sub/sup attachments are repaired,
/// not swallowed: the fixup list reports a warning at the raw insertion point.
#[test]
fn unclosed_delimiters_report_warnings() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for (name, source, needle) in [
        (
            "dollar",
            fixtures::MATH_UNCLOSED_DOLLAR,
            "unclosed math equation",
        ),
        (
            "quote",
            fixtures::MATH_UNCLOSED_QUOTE,
            "unclosed math string",
        ),
        (
            "empty_quotes",
            fixtures::MATH_EMPTY_QUOTES,
            "unclosed math string",
        ),
        (
            "empty_sub",
            fixtures::MATH_EMPTY_SUB_CALL,
            "empty math attachment",
        ),
        (
            "empty_sup",
            fixtures::MATH_EMPTY_SUP_CALL,
            "empty math attachment",
        ),
    ] {
        let mut state = harness::state();
        let id = harness::page(&mut state, name);

        let render = harness::compile(&mut state, &id, source);

        assert!(
            render
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains(needle)),
            "{name}: expected a `{needle}` warning, got {:#?}",
            render.diagnostics,
        );
    }
}

/// Recovery may rewrite the render source, but never the pristine synth or
/// its mapper. IDE features read both of those between renders.
#[test]
fn recovery_keeps_pristine_synth_and_mapper() {
    for fixture in fixtures::BROKEN_MATH {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let synth = sync_source_state(&id, fixture.source, "", RenderTarget::Svg, &mut state);

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
/// in partitioning, placeholder sizing, or the repair insertion point.
#[test]
fn recovery_svg_snapshots() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for (name, source) in [
        ("math_broken_ident", fixtures::MATH_BROKEN_IDENT),
        (
            "math_broken_call_undefined",
            fixtures::MATH_BROKEN_CALL_UNDEFINED,
        ),
        ("math_unclosed_dollar", fixtures::MATH_UNCLOSED_DOLLAR),
        ("math_unclosed_quote", fixtures::MATH_UNCLOSED_QUOTE),
        ("math_empty_quotes", fixtures::MATH_EMPTY_QUOTES),
        ("math_empty_sub_call", fixtures::MATH_EMPTY_SUB_CALL),
        ("math_sub_paren", fixtures::MATH_SUB_PAREN),
    ] {
        let mut state = harness::state();
        let id = harness::page(&mut state, name);

        let render = render_svgs_by_items(&id, source, "", &mut state);

        assert!(!render.frames.is_empty(), "{name}: no SVG frames");

        for (index, frame) in render.frames.iter().enumerate() {
            insta::assert_snapshot!(format!("{name}_frame_{index}"), frame.render.svg);
        }
    }
}
