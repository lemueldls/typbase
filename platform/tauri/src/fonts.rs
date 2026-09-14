use std::{collections::HashMap, fs, path::PathBuf, sync::OnceLock};

use serde::Serialize;
use tauri::ipc::Response;

#[derive(Clone)]
enum FontSource {
    /// Read when the file is requested.
    Path(PathBuf),
    /// Embedded data (fontdb's in-memory sources); kept in the index.
    Bytes(Vec<u8>),
}

#[derive(Serialize, Clone)]
pub struct SystemFontFace {
    /// Unique family names in this file; used by the settings picker.
    pub families: Vec<String>,
    /// Human-readable styles, e.g. "Regular, Bold Italic".
    pub style: String,
    pub monospaced: bool,
    /// Any face carries an OpenType MATH table.
    pub math: bool,
    /// Every face carries MATH, so the file is a math font, not a text font.
    pub math_only: bool,
    /// Any face covers basic Latin letters; filters out symbol/emoji fonts.
    pub text: bool,
    /// Position in the index; pass to `system_font_file`.
    pub index: usize,
    #[serde(skip)]
    source: FontSource,
}

#[derive(Clone, Copy)]
struct FaceFlags {
    math: bool,
    latin: bool,
    monospaced: bool,
}

const NO_FLAGS: FaceFlags = FaceFlags {
    math: false,
    latin: false,
    monospaced: false,
};

/// Style buckets come from the font itself: the MATH table marks math fonts,
/// Latin coverage filters symbol fonts, and the monospace flag marks code
/// fonts. Browsers cannot do this (Local Font Access exposes names only).
fn face_flags(database: &fontdb::Database, face: &fontdb::FaceInfo) -> FaceFlags {
    database
        .with_face_data(face.id, |data, index| {
            let Ok(parsed) = ttf_parser::Face::parse(data, index) else {
                return NO_FLAGS;
            };

            FaceFlags {
                math: parsed.tables().math.is_some(),
                latin: parsed.glyph_index('A').is_some() && parsed.glyph_index('a').is_some(),
                monospaced: parsed.is_monospaced(),
            }
        })
        .unwrap_or(NO_FLAGS)
}

static SYSTEM_FONTS: OnceLock<Vec<SystemFontFace>> = OnceLock::new();

fn weight_label(weight: fontdb::Weight) -> &'static str {
    match weight.0 {
        0..=149 => "Thin",
        150..=249 => "ExtraLight",
        250..=349 => "Light",
        350..=449 => "Regular",
        450..=549 => "Medium",
        550..=649 => "SemiBold",
        650..=749 => "Bold",
        750..=849 => "ExtraBold",
        _ => "Black",
    }
}

fn style_label(face: &fontdb::FaceInfo) -> String {
    let mut parts = Vec::new();
    match face.style {
        fontdb::Style::Normal => {}
        fontdb::Style::Italic => parts.push("Italic"),
        fontdb::Style::Oblique => parts.push("Oblique"),
    }
    parts.push(weight_label(face.weight));

    parts.join(" ")
}

fn build_index() -> Vec<SystemFontFace> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut entries: Vec<SystemFontFace> = Vec::new();
    // Faces from one file (e.g. a `.ttc`) install once: `installFont` reads
    // every face in the bytes.
    let mut by_source: HashMap<String, usize> = HashMap::new();

    for face in database.faces() {
        let flags = face_flags(&database, face);

        let (key, source) = match &face.source {
            fontdb::Source::File(path) | fontdb::Source::SharedFile(path, _) => (
                path.to_string_lossy().to_string(),
                FontSource::Path(path.clone()),
            ),
            fontdb::Source::Binary(_) => {
                let data = database
                    .with_face_data(face.id, |data, _| data.to_vec())
                    .unwrap_or_default();
                (format!("binary:{}", face.id), FontSource::Bytes(data))
            }
        };

        let index = match by_source.get(&key) {
            Some(index) => *index,
            None => {
                let index = entries.len();
                by_source.insert(key, index);
                entries.push(SystemFontFace {
                    families: Vec::new(),
                    style: String::new(),
                    monospaced: flags.monospaced && flags.latin,
                    math: flags.math,
                    math_only: flags.math,
                    text: flags.latin,
                    index,
                    source,
                });
                index
            }
        };

        let entry = &mut entries[index];
        for (family, _) in &face.families {
            if !entry.families.iter().any(|known| known == family) {
                entry.families.push(family.clone());
            }
        }
        let label = style_label(face);
        if entry.style.is_empty() {
            entry.style = label;
        } else if !entry.style.contains(&label) {
            entry.style.push_str(", ");
            entry.style.push_str(&label);
        }
        entry.monospaced |= flags.monospaced && flags.latin;
        entry.math |= flags.math;
        entry.math_only &= flags.math;
        entry.text |= flags.latin;
    }

    entries.sort_by(|a, b| {
        a.families
            .first()
            .cmp(&b.families.first())
            .then_with(|| a.style.cmp(&b.style))
    });
    // Sorting invalidates the build-time index; rebind it to the final order.
    for (position, entry) in entries.iter_mut().enumerate() {
        entry.index = position;
    }

    entries
}

fn system_fonts() -> &'static Vec<SystemFontFace> {
    SYSTEM_FONTS.get_or_init(build_index)
}

/// Metadata for every installed font file; no bytes are read here.
#[tauri::command]
pub async fn system_font_index() -> Result<Vec<SystemFontFace>, String> {
    tauri::async_runtime::spawn_blocking(|| system_fonts().clone())
        .await
        .map_err(|error| error.to_string())
}

/// One font file's bytes, raw over IPC so the transfer stays binary.
#[tauri::command]
pub async fn system_font_file(index: usize) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = system_fonts().get(index).ok_or("unknown font index")?;

        match &entry.source {
            FontSource::Bytes(data) => Ok::<_, String>(Response::new(data.clone())),
            FontSource::Path(path) => fs::read(path)
                .map(Response::new)
                .map_err(|error| error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_points_at_real_font_files() {
        let index = build_index();

        for (position, entry) in index.iter().enumerate() {
            assert_eq!(entry.index, position, "index must match position");
            assert!(!entry.families.is_empty(), "every face has a family");
        }

        // The first entry must be readable through the file command's source.
        if let Some(first) = index.first() {
            match &first.source {
                FontSource::Path(path) => {
                    let bytes = fs::read(path).expect("font file must read");
                    assert!(!bytes.is_empty());
                }
                FontSource::Bytes(data) => assert!(!data.is_empty()),
            }
        }

        eprintln!(
            "system fonts: {} files, {} families, {} math, {} mono, {} text",
            index.len(),
            index
                .iter()
                .flat_map(|entry| entry.families.iter())
                .collect::<std::collections::HashSet<_>>()
                .len(),
            index.iter().filter(|entry| entry.math).count(),
            index.iter().filter(|entry| entry.monospaced).count(),
            index
                .iter()
                .filter(|entry| entry.text && !entry.math_only)
                .count(),
        );
    }
}
