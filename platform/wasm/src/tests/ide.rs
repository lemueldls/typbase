//! IDE consistency: autocomplete, hover, and jump must read the pristine
//! synth even after a render ran error recovery. The regression this suite
//! pins down: recovery used to mark up the one shared synth file, which broke
//! property access (`integral.triple`) and hover until the next clean sync.

use crate::{
    bindings::TypstJump,
    tests::{fixtures, harness},
};

/// A page with one undefined math ident (recovery marks it red) and one
/// property access that must still complete.
const RECOVERED_PAGE: &str = "$ notdefined + 1 $\n\n$ integral.triple $\n\nAfter.";

fn utf16_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].chars().map(char::len_utf16).sum()
}

/// Cursor positions a user types through while completing `integral.triple`:
/// right after the dot and part-way through the field name.
fn field_cursors(text: &str) -> [usize; 2] {
    let dot = text.find("integral.").unwrap() + "integral.".len();
    let partial = text.find("integral.t").unwrap() + "integral.t".len();

    [utf16_offset(text, dot), utf16_offset(text, partial)]
}

fn labels_at(
    state: &mut crate::state::TypstState,
    id: &crate::bindings::TypstFileId,
    cursor: usize,
) -> Vec<String> {
    state
        .autocomplete_at(id, cursor, true)
        .map(|result| {
            result
                .completions
                .iter()
                .map(|completion| completion.label.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn clean_math_field_completion_works() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let text = "$ integral.triple $";
    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_autocomplete_clean");
    let _ = harness::compile(&mut state, &id, text);

    for cursor in field_cursors(text) {
        let labels = labels_at(&mut state, &id, cursor);

        assert!(
            labels.iter().any(|label| label == "triple"),
            "control fixture does not complete field access at {cursor}: labels={labels:?}",
        );
    }
}

#[test]
fn autocomplete_survives_recovered_render() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_autocomplete");
    let render = harness::compile(&mut state, &id, RECOVERED_PAGE);

    assert!(render.document.is_some());
    assert!(
        render
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("unknown variable")),
        "fixture did not trigger the marking pass: {:#?}",
        render.diagnostics,
    );

    for cursor in field_cursors(RECOVERED_PAGE) {
        let labels = labels_at(&mut state, &id, cursor);

        assert!(
            labels.iter().any(|label| label == "triple"),
            "property completion lost after recovery at {cursor}: labels={labels:?}",
        );
    }
}

#[test]
fn hover_survives_recovered_render() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_hover");
    let render = harness::compile(&mut state, &id, RECOVERED_PAGE);

    assert!(render.document.is_some());

    let cursor = RECOVERED_PAGE.find("integral").unwrap() + 2;
    let tooltip = state.hover(&id, utf16_offset(RECOVERED_PAGE, cursor), 1);

    assert!(tooltip.is_some(), "hover returned nothing after recovery");
}

#[test]
fn jump_maps_both_sources_to_raw() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_jump");
    let _ = harness::compile(&mut state, &id, RECOVERED_PAGE);

    let context = state.source_context_map.get(&id).unwrap();

    let render_text = context
        .render_source(&state.world)
        .unwrap()
        .text()
        .to_string();
    let synth_text = context
        .synth_source(&state.world)
        .unwrap()
        .text()
        .to_string();

    let expected = utf16_offset(RECOVERED_PAGE, RECOVERED_PAGE.find("After").unwrap());

    for (file_id, text) in [
        (context.render_id, render_text),
        (context.synth_id, synth_text),
    ] {
        let position = text
            .find("After")
            .expect("fixture text missing from source");
        let jump = TypstJump::from_mapped(
            typst_ide::Jump::File(file_id, position),
            context,
            &state.world,
        );

        match jump {
            Some(TypstJump::File { position }) => assert_eq!(position, expected),
            other => panic!("jump did not map to a raw file position: {other:?}"),
        }
    }
}

#[test]
fn jump_maps_repaired_positions_to_raw() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_jump_repaired");
    let source = fixtures::MATH_UNCLOSED_DOLLAR;
    let _ = harness::compile(&mut state, &id, source);

    let context = state.source_context_map.get(&id).unwrap();
    let render_text = context
        .render_source(&state.world)
        .unwrap()
        .text()
        .to_string();

    let position = render_text
        .find("After paragraph.")
        .expect("text missing from render source");
    let expected = utf16_offset(source, source.find("After paragraph.").unwrap());

    let jump = TypstJump::from_mapped(
        typst_ide::Jump::File(context.render_id, position),
        context,
        &state.world,
    );

    match jump {
        Some(TypstJump::File { position }) => assert_eq!(position, expected),
        other => panic!("repaired jump did not map to a raw file position: {other:?}"),
    }
}
