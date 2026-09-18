//! Mapper invariants: the raw/synth offset correspondence must survive a
//! render, including one that ran error recovery.

use crate::tests::{fixtures, harness};

/// Every anchor must map back to its own raw position in at least one
/// direction. A failure here means recovery rewrote the synth without
/// updating the anchors that describe it.
#[test]
fn clean_mapper_anchor_round_trip() {
    for fixture in fixtures::CLEAN {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let _ = harness::compile(&mut state, &id, fixture.source);

        let context = state.source_context_map.get(&id).unwrap();
        let mapper = &context.index_mapper;

        for anchor in mapper.anchors() {
            let left = mapper.map_synth_to_raw_from_left(anchor.synth);
            let right = mapper.map_synth_to_raw_from_right(anchor.synth);

            assert!(
                left == anchor.raw || right == anchor.raw,
                "{}: anchor {:?} round-trip failed: left {left}, right {right}",
                fixture.name,
                anchor,
            );
        }
    }
}

/// The pristine mapper describes text whose anchors stay inside the raw
/// source and whose synth positions stay inside the synth. Recovery must not
/// push either axis out of bounds.
#[test]
fn clean_mapper_stays_in_bounds() {
    for fixture in fixtures::CLEAN {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);

        let _ = harness::compile(&mut state, &id, fixture.source);

        let context = state.source_context_map.get(&id).unwrap();
        let raw_len = fixture.source.len();
        let synth_len = context
            .synth_source(&state.world)
            .map(|source| source.text().len())
            .unwrap_or_default();

        for anchor in context.index_mapper.anchors() {
            assert!(
                anchor.raw <= raw_len,
                "{}: raw anchor out of bounds: {anchor:?}",
                fixture.name
            );
            assert!(
                anchor.synth <= synth_len,
                "{}: synth anchor out of bounds: {anchor:?} (synth len {synth_len})",
                fixture.name,
            );
        }
    }
}
