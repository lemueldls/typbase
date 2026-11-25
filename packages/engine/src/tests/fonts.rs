//! Fonts: the family a file declares, and the typographic features the
//! generated prelude turns on. Both feed settings the app cannot derive on its
//! own, so they are pinned here.

use typst::text::{Coverage, FontBook, FontFlags, FontInfo, FontVariant};

use crate::{
    fonts::{face_info, family_names, uncovered_scripts},
    state::TypstState,
    tests::harness,
    theme::ThemeColors,
};

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
        family_names(&bundled("code/IosevkaConcreteCode-Regular.ttf")),
        vec![String::from("Iosevka Concrete Code")]
    );
    assert_eq!(
        family_names(&bundled("text/IosevkaConcreteText-Regular.ttf")),
        vec![String::from("Iosevka Concrete Text")]
    );
    assert_eq!(
        family_names(&bundled("math/ConcreteMath-Regular.otf")),
        vec![String::from("Concrete Math")]
    );
}

#[test]
fn reads_each_face_weight_and_style() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let iosevka_regular = face_info(&bundled("code/IosevkaConcreteCode-Regular.ttf"));
    assert_eq!(iosevka_regular.len(), 1);
    assert_eq!(iosevka_regular[0].family, "Iosevka Concrete Code");
    assert_eq!(iosevka_regular[0].weight, 400);
    assert_eq!(iosevka_regular[0].style, "normal");

    let iosevka_bold_italic = face_info(&bundled("code/IosevkaConcreteCode-BoldItalic.ttf"));
    assert_eq!(iosevka_bold_italic.len(), 1);
    assert_eq!(iosevka_bold_italic[0].family, "Iosevka Concrete Code");
    assert_eq!(iosevka_bold_italic[0].weight, 700);
    assert_eq!(iosevka_bold_italic[0].style, "italic");

    let text_regular = face_info(&bundled("text/IosevkaConcreteText-Regular.ttf"));
    assert_eq!(text_regular.len(), 1);
    assert_eq!(text_regular[0].family, "Iosevka Concrete Text");
    assert_eq!(text_regular[0].weight, 400);
    assert_eq!(text_regular[0].style, "normal");

    let text_bold = face_info(&bundled("text/IosevkaConcreteText-Bold.ttf"));
    assert_eq!(text_bold.len(), 1);
    assert_eq!(text_bold[0].family, "Iosevka Concrete Text");
    assert_eq!(text_bold[0].weight, 700);
    assert_eq!(text_bold[0].style, "normal");

    let math_bold = face_info(&bundled("math/ConcreteMath-Bold.otf"));
    assert_eq!(math_bold.len(), 1);
    assert_eq!(math_bold[0].family, "Concrete Math");
    assert_eq!(math_bold[0].weight, 700);
    assert_eq!(math_bold[0].style, "normal");
}

#[test]
fn reports_nothing_for_bytes_that_are_not_a_font() {
    assert!(family_names(b"not a font at all").is_empty());
    assert!(family_names(&[]).is_empty());
    assert!(face_info(b"not a font at all").is_empty());
}

fn style(ligatures: bool, kerning: bool) -> String {
    TypstState::style_prelude_export(
        ThemeColors::default(),
        16.0,
        String::from("Iosevka Concrete Text"),
        None,
        None,
        String::from("en"),
        ligatures,
        kerning,
        true,
    )
}

#[test]
fn typography_reaches_the_generated_prelude() {
    assert!(style(true, true).contains("ligatures:true,kerning:true"));
    assert!(style(false, false).contains("ligatures:false,kerning:false"));
    // The two are independent, so one can be off without the other.
    assert!(style(false, true).contains("ligatures:false,kerning:true"));
}

#[test]
fn reports_scripts_the_bundled_fonts_cannot_draw() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let state = harness::state();
    assert!(state.uncovered_scripts("Hello, world!").is_empty());
    assert!(
        state
            .uncovered_scripts("你好")
            .contains(&String::from("Hani"))
    );
    assert!(
        state
            .uncovered_scripts("😀")
            .contains(&String::from("Emoji"))
    );
    // Fullwidth punctuation has no script of its own but only CJK faces carry it.
    assert!(
        state
            .uncovered_scripts("，")
            .contains(&String::from("Hani"))
    );
    // Joiners and variation selectors have no glyph of their own.
    assert!(state.uncovered_scripts("\u{200D}\u{FE0F}").is_empty());
}

#[test]
fn a_covering_face_clears_the_script() {
    let book = FontBook::from_infos([FontInfo {
        family: String::from("Test Han"),
        variant: FontVariant::default(),
        flags: FontFlags::empty(),
        axes: Vec::new(),
        coverage: Coverage::from_vec(vec!['你' as u32]),
    }]);

    assert!(uncovered_scripts(&book, "你").is_empty());
    assert_eq!(uncovered_scripts(&book, "你好"), vec![String::from(
        "Hani"
    )]);
}
