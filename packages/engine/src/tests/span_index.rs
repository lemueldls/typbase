//! Span index reuse across frame walks.
//!
//! A caret move compiles again with the same sources, so the offsets the last
//! walk resolved still hold. A source rewrite, from recovery or a new sync,
//! renumbers the tree and must drop them.

use typst_syntax::LinkedNode;

use crate::tests::harness;

#[test]
fn a_second_walk_reuses_the_index_until_a_source_changes() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "span_index");
    let text = "= Title\n\nHello $x + y$.\n";
    let _ = harness::compile_svg(&mut state, &id, text);

    let context = state.source_context_map.get(&id).unwrap();

    let (span, range) = {
        let source = context.render_source(&state.world).unwrap();
        let node = LinkedNode::new(source.root()).children().next().unwrap();
        (node.span(), node.range())
    };

    context.begin_frame_walk();
    assert_eq!(
        context.span_range(&state.world, span).as_ref(),
        Some(&range)
    );

    let entries = context.span_index_entries();
    assert!(entries > 0, "the walk recorded nothing");

    // Same sources, new walk: the index stays.
    context.begin_frame_walk();
    assert_eq!(
        context.span_index_entries(),
        entries,
        "an unchanged source rebuilt the index"
    );

    // Recovery rewrites the render source through the mutable accessor. The
    // next walk must not answer from ranges that belong to the old tree.
    let _ = context.render_source_mut(&mut state.world);
    context.begin_frame_walk();
    assert_eq!(
        context.span_index_entries(),
        0,
        "a rewritten source kept its ranges"
    );
}

#[test]
fn replacing_an_imported_file_drops_every_index() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    let id = harness::page(&mut state, "span_index_import");
    let _ = harness::compile_svg(&mut state, &id, "= Title\n\nHello.\n");

    let context = state.source_context_map.get(&id).unwrap();
    context.begin_frame_walk();
    assert!(context.span_index_entries() > 0);

    let imported = state.create_file_id("typbase/src/other.typ");
    state.insert_source(&imported, "Another page's text.".to_string());

    let context = state.source_context_map.get(&id).unwrap();
    context.begin_frame_walk();
    assert_eq!(
        context.span_index_entries(),
        0,
        "a replaced import kept the note's span ranges"
    );
}
