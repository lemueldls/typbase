use typst::{
    foundations::Bytes,
    text::{Font, FontBook},
    utils::LazyHash,
};

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
    where
        T: AsRef<[u8]> + Send + Sync + 'static,
    {
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
