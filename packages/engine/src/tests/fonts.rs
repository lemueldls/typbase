//! Fonts: the family a file declares, and the typographic features the
//! generated prelude turns on. Both feed settings the app cannot derive on its
//! own, so they are pinned here.

use crate::{fonts::family_names, state::TypstState, tests::harness, theme::ThemeColors};

fn bundled(rel: &str) -> Vec<u8> {
    std::fs::read(harness::fonts_dir().join(rel)).expect("bundled font")
}

#[test]
fn reads_the_family_a_font_declares() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    // The typographic family is what a font menu shows.
    assert_eq!(
        family_names(&bundled("maple/MapleMono-Regular.ttf")),
        vec![String::from("Maple Mono")]
    );
    assert_eq!(
        family_names(&bundled("math/NewCMMath-Regular.otf")),
        vec![String::from("New Computer Modern Math")]
    );
}

#[test]
fn reports_nothing_for_bytes_that_are_not_a_font() {
    assert!(family_names(b"not a font at all").is_empty());
    assert!(family_names(&[]).is_empty());
}

fn style(ligatures: bool, kerning: bool) -> String {
    TypstState::style_prelude_export(
        ThemeColors::default(),
        16.0,
        String::from("Maple Mono"),
        None,
        None,
        String::from("en"),
        ligatures,
        kerning,
    )
}

#[test]
fn typography_reaches_the_generated_prelude() {
    assert!(style(true, true).contains("ligatures:true,kerning:true"));
    assert!(style(false, false).contains("ligatures:false,kerning:false"));
    // The two are independent, so one can be off without the other.
    assert!(style(false, true).contains("ligatures:false,kerning:true"));
}
