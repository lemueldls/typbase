//! Typing is a sequence of prefixes. Every prefix of every fixture must sync
//! without panicking and leave sound maps.
//!
//! This is the engine-level twin of the debug lab's typing simulation. It
//! would have caught the unclosed-fence panic: the parser folds the unfinished
//! raw into one error leaf, and the synth builder wrapped the block before it
//! a second time, producing an out-of-order map.

use crate::{
    renderer::paged::PagedRender,
    source::{RenderTarget, sync_source_state},
    tests::{fixtures, harness},
};

/// Fixtures the render-level prefix pass walks. Short enough to compile every
/// stride without turning the suite into a benchmark.
const RENDER_PREFIXES: &[&str] = &[
    "incomplete_block_comment",
    "incomplete_call",
    "incomplete_deep",
    "incomplete_fence",
    "incomplete_inline_raw",
];

/// The number of bytes a prefix has in UTF-16, the space chunk ranges use.
fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

fn check_ranges(render: &PagedRender, length: usize, name: &str, end: usize) {
    let mut last = 0;

    for chunk in &render.chunks {
        assert!(
            chunk.range.start <= chunk.range.end,
            "{name}: chunk range inverted at prefix {end}: {:?}",
            chunk.range,
        );
        assert!(
            chunk.range.end <= length,
            "{name}: chunk range past the document at prefix {end}: {:?} (len {length})",
            chunk.range,
        );
        assert!(
            chunk.range.start >= last,
            "{name}: chunk ranges regressed at prefix {end}: {:?}",
            chunk.range,
        );

        last = chunk.range.start;
    }
}

/// Syncing every prefix must keep all three maps sound. This runs without
/// fonts, so it covers every fixture, clean and broken alike.
#[test]
fn every_prefix_syncs_with_sound_maps() {
    for fixture in fixtures::clean()
        .into_iter()
        .chain(fixtures::broken())
        .chain(fixtures::adversarial())
    {
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        for end in 0..=fixture.source.len() {
            if !fixture.source.is_char_boundary(end) {
                continue;
            }

            let prefix = &fixture.source[..end];
            let _ = sync_source_state(&id, prefix, "", RenderTarget::Svg, &mut state);

            let context = state.source_context_map.get(&id).unwrap();

            assert!(
                context.index_map.validate().is_empty(),
                "{}: index map unsound at prefix {end}",
                fixture.name,
            );
            assert!(
                context.render_map.validate().is_empty(),
                "{}: render map unsound at prefix {end}",
                fixture.name,
            );
            assert!(
                context.render_fixups.map().validate().is_empty(),
                "{}: fixup map unsound at prefix {end}",
                fixture.name,
            );
        }
    }
}

/// A sampled render-level pass: every prefix compiles to a document and its
/// chunk ranges stay inside the prefix and in order.
#[test]
fn every_prefix_renders_without_panicking() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    for name in RENDER_PREFIXES {
        let fixture = fixtures::get("broken", name);
        let mut state = harness::state();
        let id = harness::page(&mut state, &fixture.name);

        for end in (0..=fixture.source.len()).step_by(3) {
            if !fixture.source.is_char_boundary(end) {
                continue;
            }

            let prefix = &fixture.source[..end];
            let render = harness::compile(&mut state, &id, prefix);

            assert!(
                render.document.is_some(),
                "{name}: no document at prefix {end}: {:#?}",
                render.diagnostics,
            );

            check_ranges(&render, utf16_len(prefix), name, end);
        }
    }
}
