//! `sys.inputs`: the host values a compile can read.

use crate::tests::harness;

#[test]
fn set_inputs_reaches_sys_inputs() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let mut state = harness::state();
    state.set_inputs(Some("p1".into()), Some("demo".into()), "test".into());

    let id = harness::page(&mut state, "inputs");
    let text = concat!(
        "#assert(sys.inputs.page == \"p1\")\n",
        "#assert(sys.inputs.workspace == \"demo\")\n",
        "#assert(sys.inputs.reason == \"test\")\n",
        "\nOK\n",
    );

    let render = harness::compile(&mut state, &id, text);
    assert!(render.diagnostics.is_empty(), "{:?}", render.diagnostics);
}

#[test]
fn invalid_inputs_clear_sys_inputs() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let mut state = harness::state();
    state.set_inputs(Some("p1".into()), Some("demo".into()), "test".into());
    // A later call replaces the whole set. Omitted values must not linger.
    state.set_inputs(None, None, "test".into());

    let id = harness::page(&mut state, "inputs-empty");
    let text = concat!(
        "#assert(sys.inputs.at(\"page\", default: none) == none)\n",
        "#assert(sys.inputs.at(\"workspace\", default: none) == none)\n",
        "#assert(sys.inputs.reason == \"test\")\n",
        "\nOK\n",
    );

    let render = harness::compile(&mut state, &id, text);
    assert!(render.diagnostics.is_empty(), "{:?}", render.diagnostics);
}
