//! IDE consistency: autocomplete, hover, and jump must read the pristine
//! synth even after a render ran error recovery. The regression this suite
//! pins down: recovery used to mark up the one shared synth file, which broke
//! property access (`integral.triple`) and hover until the next clean sync.

use crate::{
    bindings::TypstJump,
    tests::{fixtures, harness},
};

/// A page with one undefined math ident (recovery marks it red) and two
/// completion targets after it: a plain math ident and a property access.
fn recovered_page() -> fixtures::Fixture {
    fixtures::get("broken", "recovered_page")
}

fn utf16_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].chars().map(char::len_utf16).sum()
}

/// Completes a prefix and asserts both the label and the `from` offset
/// CodeMirror uses to filter the option list. `expected_from` is the byte
/// offset the replacement should start at: the start of a plain ident, or the
/// start of the field part for property access.
fn assert_completion(
    state: &mut crate::state::TypstState,
    id: &crate::bindings::TypstFileId,
    text: &str,
    prefix: &str,
    expected_from: usize,
    label: &str,
) {
    let start = text.find(prefix).expect("prefix missing from fixture");
    let cursor = utf16_offset(text, start + prefix.len());
    let expected_from = utf16_offset(text, expected_from);

    let result = state
        .autocomplete_at(id, cursor, true)
        .expect("autocomplete returned nothing after recovery");

    let labels = result
        .completions
        .iter()
        .map(|completion| completion.label.clone())
        .collect::<Vec<_>>();

    assert!(
        labels.iter().any(|candidate| candidate == label),
        "missing `{label}` for `{prefix}`: {labels:?}",
    );
    assert_eq!(
        result.offset, expected_from,
        "completion start offset for `{prefix}`",
    );
}

#[test]
fn clean_math_field_completion_works() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let text = "$ qu + integral.triple $";
    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_autocomplete_clean");
    let _ = harness::compile(&mut state, &id, text);

    let integral = text.find("integral").unwrap();
    let field = integral + "integral.".len();

    assert_completion(
        &mut state,
        &id,
        text,
        "qu",
        text.find("qu").unwrap(),
        "quad",
    );
    assert_completion(&mut state, &id, text, "integral.", field, "triple");
    assert_completion(&mut state, &id, text, "integral.tri", field, "triple");
}

#[test]
fn autocomplete_survives_recovered_render() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let page = recovered_page();
    let text = &page.source;

    let mut state = harness::state();
    let id = harness::page(&mut state, &page.name);
    let render = harness::compile(&mut state, &id, text);

    assert!(render.document.is_some());
    assert!(
        render
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("unknown variable")),
        "fixture did not trigger the marking pass: {:#?}",
        render.diagnostics,
    );

    let integral = text.find("integral").unwrap();
    let field = integral + "integral.".len();

    assert_completion(
        &mut state,
        &id,
        text,
        "qu",
        text.find("qu").unwrap(),
        "quad",
    );
    assert_completion(&mut state, &id, text, "integral.", field, "triple");
    assert_completion(&mut state, &id, text, "integral.tri", field, "triple");
}

#[test]
fn hover_survives_recovered_render() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let page = recovered_page();
    let text = &page.source;

    let mut state = harness::state();
    let id = harness::page(&mut state, &page.name);
    let render = harness::compile(&mut state, &id, text);

    assert!(render.document.is_some());

    let cursor = text.find("integral").unwrap() + 2;
    let tooltip = state.hover(&id, utf16_offset(text, cursor), 1);

    assert!(tooltip.is_some(), "hover returned nothing after recovery");
}

#[test]
fn jump_maps_both_sources_to_raw() {
    let page = recovered_page();
    let text = &page.source;

    let mut state = harness::state();
    let id = harness::page(&mut state, &page.name);
    let _ = harness::compile(&mut state, &id, text);

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

    let expected = utf16_offset(text, text.find("After").unwrap());

    for (file_id, source_text) in [
        (context.render_id, render_text),
        (context.synth_id, synth_text),
    ] {
        let position = source_text
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
    let fixture = fixtures::get("broken", "unclosed_dollar");
    let source = &fixture.source;

    let mut state = harness::state();
    let id = harness::page(&mut state, &fixture.name);
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
        other => panic!("jump did not map to a raw file position: {other:?}"),
    }
}
