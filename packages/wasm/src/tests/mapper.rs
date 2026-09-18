//! Source-map invariants: every byte of every fixture must round-trip
//! through copied segments, generated spans must clamp to their insertion
//! point, and both directions must stay in bounds and monotone.
//!
//! The checks are independent of the lookup implementation: they walk the
//! segment list, compare copied bytes against the real texts, and probe every
//! offset rather than sampling.

use crate::{
    source::{RenderTarget, Segment, Side, SourceMap, sync_source_state},
    tests::{fixtures, harness},
};

/// Verifies a map against the two texts it relates.
fn check_map(map: &SourceMap, from: &str, to: &str, name: &str) {
    assert_eq!(map.from_len(), from.len(), "{name}: from_len");
    assert_eq!(map.to_len(), to.len(), "{name}: to_len");

    let problems = map.validate();
    assert!(problems.is_empty(), "{name}: {problems:#?}");

    for (index, segment) in map.segments().iter().enumerate() {
        match segment {
            Segment::Copy {
                from: range,
                to: range_to,
                ..
            } => {
                assert_eq!(
                    &from[range.clone()],
                    &to[range_to.clone()],
                    "{name}: segment {index} copied bytes differ",
                );

                for (source, target) in (range.start..range.end).zip(range_to.start..range_to.end) {
                    assert_eq!(
                        map.forward(source, Side::After),
                        target,
                        "{name}: forward({source})",
                    );
                    assert!(
                        map.forward(source, Side::Before) <= target,
                        "{name}: before({source}) passed the copy start",
                    );
                    assert_eq!(map.backward(target), source, "{name}: backward({target})");
                }
            }
            Segment::Generated {
                from: point,
                to: range,
                ..
            } => {
                for target in range.clone() {
                    assert_eq!(
                        map.backward(target),
                        *point,
                        "{name}: generated backward({target})",
                    );
                }
                assert_eq!(
                    map.forward(*point, Side::After),
                    range.end,
                    "{name}: generated forward({point})",
                );
            }
        }
    }

    let mut last_before = 0;
    let mut last_after = 0;
    for source in 0..=from.len() {
        let before = map.forward(source, Side::Before);
        let after = map.forward(source, Side::After);

        assert!(before <= after, "{name}: sides crossed at {source}");
        assert!(after <= to.len(), "{name}: forward({source}) escaped");
        assert!(
            before >= last_before && after >= last_after,
            "{name}: forward regressed at {source}",
        );

        last_before = before;
        last_after = after;
    }

    let mut last = 0;
    for target in 0..=to.len() {
        let source = map.backward(target);

        assert!(source <= from.len(), "{name}: backward({target}) escaped");
        assert!(source >= last, "{name}: backward regressed at {target}");

        last = source;
    }
}

fn all_fixtures() -> impl Iterator<Item = &'static fixtures::Fixture> {
    fixtures::CLEAN
        .iter()
        .chain(fixtures::BROKEN_MATH)
        .chain(fixtures::ADVERSARIAL)
}

/// Sync alone builds all three maps: raw to pristine synth, raw to repaired,
/// and repaired to render. Each must satisfy the full contract.
#[test]
fn maps_are_sound_for_all_fixtures() {
    for fixture in all_fixtures() {
        let mut state = crate::state::TypstState::new();
        let id = harness::page(&mut state, fixture.name);

        let _ = sync_source_state(&id, fixture.source, "", RenderTarget::Svg, &mut state);

        let context = state.source_context_map.get(&id).unwrap();
        let repaired = context.render_fixups.repaired(fixture.source);
        let synth = context
            .synth_source(&state.world)
            .unwrap()
            .text()
            .to_string();
        let render = context
            .render_source(&state.world)
            .unwrap()
            .text()
            .to_string();

        check_map(&context.index_map, fixture.source, &synth, fixture.name);
        check_map(
            context.render_fixups.map(),
            fixture.source,
            &repaired,
            fixture.name,
        );
        check_map(&context.render_map, &repaired, &render, fixture.name);
    }
}

/// Recovery rewrites the render source and splices the render map. The map
/// must still describe the rewritten text exactly.
#[test]
fn recovered_render_maps_stay_sound() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for fixture in all_fixtures() {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let _ = harness::compile(&mut state, &id, fixture.source);

        let context = state.source_context_map.get(&id).unwrap();
        let repaired = context.render_fixups.repaired(fixture.source);
        let synth = context
            .synth_source(&state.world)
            .unwrap()
            .text()
            .to_string();
        let render = context
            .render_source(&state.world)
            .unwrap()
            .text()
            .to_string();

        check_map(&context.index_map, fixture.source, &synth, fixture.name);
        check_map(&context.render_map, &repaired, &render, fixture.name);
    }
}

/// The debug lab's self-check must pass for every fixture. This exercises
/// bounds and monotonicity over the whole raw/synth/render range.
#[test]
fn check_index_report_is_clean_for_all_fixtures() {
    for fixture in all_fixtures() {
        let mut state = crate::state::TypstState::new();
        let id = harness::page(&mut state, fixture.name);

        let report = state.check_index_report(&id, fixture.source, "");
        assert!(
            report.ok,
            "{}: mismatches {:#?}",
            fixture.name, report.mismatches,
        );
    }
}

/// A document that starts with blank lines has no source bytes before its
/// first segment. Mapping offset 0 must clamp, not underflow.
#[test]
fn leading_blank_lines_clamp_instead_of_underflowing() {
    let text = "\n\nHello after blank lines.\n";

    let mut state = crate::state::TypstState::new();
    let id = harness::page(&mut state, "leading_blank_clamp");
    let _ = sync_source_state(&id, text, "", RenderTarget::Svg, &mut state);

    let context = state.source_context_map.get(&id).unwrap();
    let prefix = context.index_map.prefix_len();

    assert_eq!(context.map_raw_to_synth(0, Side::Before), prefix);
    assert!(context.map_raw_to_synth(0, Side::After) >= prefix);
    assert_eq!(context.map_synth_to_raw(0), 0);
    assert_eq!(context.map_synth_to_raw(prefix.saturating_sub(1)), 0);
    // The boundary itself is the first generated wrapper, which sits after
    // the dropped blank lines.
    assert_eq!(context.map_synth_to_raw(prefix), 2);
}

/// Cursor queries at offset 0 of a document with leading blank lines used to
/// panic in the mapper. Both IDE entry points must survive.
#[test]
fn cursor_queries_at_offset_zero_do_not_panic() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let text = "\n\nHello world";

    let mut state = harness::state();
    let id = harness::page(&mut state, "cursor_at_zero");
    let _ = harness::compile(&mut state, &id, text);

    let _ = state.autocomplete_at(&id, 0, true);
    let _ = state.hover(&id, 0, 1);
}

/// Two unknown variables in one equation are marked in one recovery pass.
/// Each mark's raw range must cover exactly its own identifier.
#[test]
fn two_errors_in_one_equation_keep_their_raw_ranges() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let text = "Before.\n\n$ notdefined + alsoundefined $\n\nAfter.\n";

    let mut state = harness::state();
    let id = harness::page(&mut state, "two_marks");
    let render = harness::compile(&mut state, &id, text);

    assert!(render.document.is_some(), "{:#?}", render.diagnostics);

    let context = state.source_context_map.get(&id).unwrap();
    let mut ranges = context.marked_raw_ranges.clone();
    ranges.sort_by_key(|range| range.start);

    assert_eq!(ranges.len(), 2, "expected two marked ranges: {ranges:?}");
    assert_eq!(&text[ranges[0].clone()], "notdefined");
    assert_eq!(&text[ranges[1].clone()], "alsoundefined");
}
