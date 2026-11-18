use std::collections::{BTreeSet, HashSet};

use serde::Serialize;
use typst::{
    foundations::Bytes,
    text::{Font, FontBook, FontStyle, is_default_ignorable},
    utils::LazyHash,
};
use unicode_script::{Script, UnicodeScript};

/// One face a font file declares, with the weight and style a browser needs
/// to pick the right file for a @font-face rule.
#[derive(Debug, Clone, Serialize)]
pub struct FontFaceInfo {
    pub family: String,
    pub weight: u16,
    pub style: String,
}

/// Every face a font file declares, including all faces of a collection.
#[must_use]
pub fn face_info(bytes: &[u8]) -> Vec<FontFaceInfo> {
    Font::iter(Bytes::new(bytes.to_vec()))
        .filter_map(|font| {
            let info = font.info();
            if info.family.is_empty() {
                return None;
            }

            let style = match info.variant.style {
                FontStyle::Normal => "normal",
                FontStyle::Italic => "italic",
                FontStyle::Oblique => "oblique",
            };

            Some(FontFaceInfo {
                family: info.family.clone(),
                weight: info.variant.weight.to_number(),
                style: style.to_string(),
            })
        })
        .collect()
}

/// The families a font file declares, one entry per face and deduplicated.
#[must_use]
pub fn family_names(bytes: &[u8]) -> Vec<String> {
    let mut families: Vec<String> = Vec::new();

    for font in Font::iter(Bytes::new(bytes.to_vec())) {
        let family = font.info().family.clone();
        if !family.is_empty() && !families.contains(&family) {
            families.push(family);
        }
    }

    families
}

/// Scripts in the text that no installed font can draw.
///
/// Returns ISO 15924 short codes (`Hani`, `Hira`, `Hang`, `Arab`, ...). `Emoji`
/// is a pseudo-code for pictographs, which do not share a script. Whitespace,
/// control characters, default ignorables and unsupported punctuation are
/// skipped, so a font does not need a glyph for every byte in the source.
#[must_use]
pub fn uncovered_scripts(book: &FontBook, text: &str) -> Vec<String> {
    let mut uncovered = BTreeSet::new();
    let mut checked = HashSet::new();

    for c in text.chars() {
        if c.is_whitespace() || c.is_control() || is_default_ignorable(c) {
            continue;
        }
        if !checked.insert(c) {
            continue;
        }

        let script = c.script();
        let code = if script == Script::Common || script == Script::Inherited {
            if is_pictographic(c) {
                "Emoji"
            } else if is_cjk_punctuation(c) {
                "Hani"
            } else {
                continue;
            }
        } else {
            script.short_name()
        };

        if !book_covers(book, c) {
            uncovered.insert(code.to_string());
        }
    }

    uncovered.into_iter().collect()
}

fn book_covers(book: &FontBook, c: char) -> bool {
    let codepoint = c as u32;

    book.families().any(|(_, faces)| {
        faces.into_iter().any(|index| {
            book.info(index)
                .is_some_and(|info| info.coverage.contains(codepoint))
        })
    })
}

/// Pictographs live in several scripts, so the app groups them under one pack.
fn is_pictographic(c: char) -> bool {
    matches!(
        c as u32,
        0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF
    )
}

/// Fullwidth and CJK punctuation have the Common script but only CJK faces
/// carry them.
fn is_cjk_punctuation(c: char) -> bool {
    matches!(
        c as u32,
        0x3000..=0x303F | 0xFE30..=0xFE4F | 0xFF00..=0xFFEF
    )
}

#[derive(Debug, Default)]
pub struct FontLoader {
    pub book: LazyHash<FontBook>,
    pub fonts: Vec<Font>,
}

impl FontLoader {
    #[must_use]
    pub fn new() -> Self {
        Self {
            book: LazyHash::new(FontBook::new()),
            fonts: vec![],
        }
    }

    pub fn install<T>(&mut self, bytes: T)
    where T: AsRef<[u8]> + Send + Sync + 'static {
        for font in Font::iter(Bytes::new(bytes)) {
            // Installing the same font twice (a repeated settings sync, a
            // worker restart) would duplicate it in the book and the font
            // list. Keep the first copy.
            if self
                .fonts
                .iter()
                .any(|existing| existing.info() == font.info())
            {
                continue;
            }

            self.book.push(font.info().clone());
            self.fonts.push(font);
        }
    }
}
