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

/// A completion query reads the synth source, and that source is otherwise only
/// rebuilt as a side effect of a render. Write mode renders in a microtask, so
/// its queries are current. Split and source mode render on a debounce, and
/// CodeMirror's own activation delay is shorter than that, so a query arrived
/// first and answered for the previous keystroke. The editor syncs the sources
/// without rendering, which is what this covers.
#[test]
fn autocomplete_follows_a_synced_keystroke() {
    let before = "Before.\n\n#let alpha = 1\n\n#";
    let after = "Before.\n\n#let alto = 1\n\n#";

    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_source_sync");

    // A render, which is what leaves the engine holding `before`.
    let render = harness::compile(&mut state, &id, before);
    assert!(render.document.is_some());

    let labels_at = |state: &mut crate::state::TypstState, text: &str| {
        let cursor = utf16_offset(text, text.len());
        state
            .autocomplete_at(&id, cursor, true)
            .map(|result| {
                result
                    .completions
                    .iter()
                    .map(|completion| completion.label.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    let labels = labels_at(&mut state, before);
    assert!(
        labels.iter().any(|label| label == "alpha"),
        "the rendered text should complete its own binding: {labels:?}",
    );

    // The keystroke, with no render since. The engine's document still describes
    // `before`, so this is the case that used to answer for the old text.
    crate::source::sync_source_state(
        &id,
        after,
        "",
        crate::source::RenderTarget::Svg,
        &mut state,
    );

    let labels = labels_at(&mut state, after);
    assert!(
        labels.iter().any(|label| label == "alto"),
        "the synced text did not complete its own binding: {labels:?}",
    );
    assert!(
        !labels.iter().any(|label| label == "alpha"),
        "the query answered from the text before the keystroke: {labels:?}",
    );
}

/// Syncing builds sources and nothing else. A render is what discovers a missing
/// package or file, and the request protocol belongs to the render, so a sync
/// that asked for them would resolve them on every keystroke.
#[test]
fn syncing_sources_requests_nothing() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "source_sync_requests");
    let source = "#import \"@preview/absent:0.1.0\": x\n\n#let f = 1\n";

    crate::source::sync_source_state(
        &id,
        source,
        "",
        crate::source::RenderTarget::Svg,
        &mut state,
    );

    assert!(
        state.world.take_requests().is_empty(),
        "the sync asked for sources the render has not reached yet",
    );
}

/// Field completion traces the expression, and a trace is a recompile of the
/// note's source rather than a lookup in the last rendered document. So it reads
/// whatever text the sources hold, which before a source sync was the text of the
/// last render. Renaming the binding between the two texts decides the list, and
/// the field name is a dictionary key so it cannot come from anywhere else.
///
/// Every math function is also in the general math list, which is why completing
/// `integral.tri` proves nothing on its own: `triple` turns up either way.
#[test]
fn field_completion_follows_a_synced_keystroke() {
    let before = "#let d = (oldname: 1)\n\n#d.\n";
    let after = "#let d = (newname: 1)\n\n#d.\n";

    let mut state = harness::state();
    let id = harness::page(&mut state, "ide_field_sync");

    let _ = harness::compile(&mut state, &id, before);

    let fields_at = |state: &mut crate::state::TypstState, text: &str| {
        let after_dot = text.find("#d.").unwrap() + "#d.".len();
        let cursor = utf16_offset(text, after_dot);
        state
            .autocomplete_at(&id, cursor, true)
            .map(|result| {
                result
                    .completions
                    .iter()
                    .map(|completion| completion.label.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    let fields = fields_at(&mut state, before);
    assert!(
        fields.iter().any(|label| label == "oldname"),
        "the rendered text should complete its own dictionary: {fields:?}",
    );

    // The keystroke, with no render since.
    crate::source::sync_source_state(
        &id,
        after,
        "",
        crate::source::RenderTarget::Svg,
        &mut state,
    );

    let fields = fields_at(&mut state, after);
    assert!(
        fields.iter().any(|label| label == "newname"),
        "the synced text did not complete its own dictionary: {fields:?}",
    );
    assert!(
        !fields.iter().any(|label| label == "oldname"),
        "the trace recompiled the text before the keystroke: {fields:?}",
    );
}

/// Click-to-source maps a point in the frames the preview is painting, so the
/// document it reads has to be the one from that render. The editor's lint source
/// compiles the same note for diagnostics, and it used to store its document in
/// the same slot: in split mode the linter runs at 400ms against the preview's
/// 160ms, so the slot ended up holding a document from text nobody was looking
/// at, and a click resolved against the wrong layout.
#[test]
fn a_diagnostics_pass_leaves_the_painted_document_alone() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "diagnostics_document");

    let painted = "Before.\n\n= Heading\n\nAfter.\n";
    harness::compile_svg(&mut state, &id, painted);
    let jump_at_paint = state.jump_paged_at(&id, 10.0, 10.0);
    assert!(jump_at_paint.is_some(), "the painted document is not there");

    // What the lint source runs: the same recovery, no frame rendering, and no
    // document stored.
    let edited = "Before.\n\n= A much longer heading than the last one\n\nAfter.\n";
    let _ = harness::compile(&mut state, &id, edited);

    assert!(
        state.jump_paged_at(&id, 10.0, 10.0).is_some(),
        "the diagnostics pass took the painted document with it",
    );
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
