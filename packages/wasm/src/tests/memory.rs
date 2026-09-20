//! Memory-shaped invariants: closed pages release their state, repeated
//! compiles do not grow the world, marks do not accumulate, and duplicate
//! font installs are ignored.

use crate::tests::harness;

const TEXT: &str = "Hello, *world*.\n\nSecond paragraph with `code`.\n";

#[test]
fn closing_pages_releases_their_files() {
    let mut state = harness::state();
    let baseline = state.world.files.len();

    for index in 0..8 {
        let id = harness::page(&mut state, &format!("release_{index}"));
        let _ = harness::compile(&mut state, &id, TEXT);
        state.remove_file(&id);
    }

    assert_eq!(
        state.world.files.len(),
        baseline,
        "closed pages left files behind",
    );
    assert!(
        state.source_context_map.is_empty(),
        "closed pages left contexts behind",
    );
}

/// An unfinished construct is repaired on every compile; the world and its
/// maps must not grow across them.
#[test]
fn repeated_incomplete_compiles_keep_the_world_stable() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "incomplete_stable");
    let text = "Before.\n\n```\nlet x = 1\n\nAfter the incomplete block.\n";

    let _ = harness::compile(&mut state, &id, text);

    let files = state.world.files.len();

    for _ in 0..25 {
        let _ = harness::compile(&mut state, &id, text);
    }

    assert_eq!(state.world.files.len(), files, "compiles grew the file map");
}

#[test]
fn repeated_compiles_keep_the_world_stable() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "stable");
    let _ = harness::compile(&mut state, &id, TEXT);

    let files = state.world.files.len();
    let segments = state
        .source_context_map
        .get(&id)
        .unwrap()
        .index_map
        .segments()
        .len();

    for _ in 0..25 {
        let _ = harness::compile(&mut state, &id, TEXT);
    }

    assert_eq!(state.world.files.len(), files, "compiles grew the file map");
    assert_eq!(
        state
            .source_context_map
            .get(&id)
            .unwrap()
            .index_map
            .segments()
            .len(),
        segments,
        "compiles grew the index map",
    );
}

#[test]
fn recovery_marks_do_not_accumulate() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "marks");
    let source = "$ notdefined + 1 $\n";

    let _ = harness::compile(&mut state, &id, source);
    let first = state
        .source_context_map
        .get(&id)
        .unwrap()
        .marked_raw_ranges
        .len();
    assert!(first > 0, "fixture did not produce marks");

    for _ in 0..5 {
        let _ = harness::compile(&mut state, &id, source);

        assert_eq!(
            state
                .source_context_map
                .get(&id)
                .unwrap()
                .marked_raw_ranges
                .len(),
            first,
            "marks accumulated across compiles",
        );
    }
}

#[test]
fn duplicate_font_installs_are_ignored() {
    let path = harness::fonts_dir().join("maple/MapleMono-Regular.ttf");
    let Ok(bytes) = std::fs::read(&path) else {
        eprintln!("skipping: bundled fonts missing");
        return;
    };

    let mut state = harness::state();
    let before = state.world.font_count();

    for _ in 0..3 {
        state.install_font(bytes.clone());
    }

    assert_eq!(
        state.world.font_count(),
        before,
        "duplicate font installs added fonts",
    );
}
