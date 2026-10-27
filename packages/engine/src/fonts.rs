use serde::Serialize;
use typst::{
    foundations::Bytes,
    text::{Font, FontBook, FontStyle},
    utils::LazyHash,
};

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
            // worker restart) used to duplicate it in the book and the font
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
