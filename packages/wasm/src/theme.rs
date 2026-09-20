use std::fmt;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Colors handed to Typst as the `theme` dictionary. The slots mirror the
/// app's resolved `ThemePaletteTokens` one to one (plus derived `on-*` text
/// colors), so a single token set styles both the chrome and rendered pages.
/// The dict keys in [`fmt::Display`] are the kebab-case token names Typst
/// code reads. `overlay` stays chrome-only: it carries alpha and Rgb cannot.
#[allow(clippy::unsafe_derive_deserialize)]
#[derive(Debug, Clone, Copy, Hash, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct ThemeColors {
    surface: Rgb,
    surface2: Rgb,
    surface3: Rgb,

    border: Rgb,
    border_strong: Rgb,

    text: Rgb,
    text_secondary: Rgb,

    accent: Rgb,
    accent_soft: Rgb,
    on_accent: Rgb,

    ok: Rgb,
    ok_soft: Rgb,

    warning: Rgb,
    warning_soft: Rgb,

    danger: Rgb,
    danger_soft: Rgb,
    on_danger: Rgb,

    info: Rgb,
    info_soft: Rgb,

    red: Rgb,
    orange: Rgb,
    yellow: Rgb,
    green: Rgb,
    cyan: Rgb,
    blue: Rgb,
    violet: Rgb,

    code: Rgb,
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            surface: Rgb::WHITE,
            surface2: Rgb(243, 244, 246),
            surface3: Rgb(233, 235, 238),

            border: Rgb(229, 231, 235),
            border_strong: Rgb(209, 213, 219),

            text: Rgb(31, 35, 40),
            text_secondary: Rgb(107, 114, 128),

            accent: Rgb(30, 90, 160),
            accent_soft: Rgb(228, 235, 244),
            on_accent: Rgb::WHITE,

            ok: Rgb(47, 111, 79),
            ok_soft: Rgb(230, 238, 234),

            warning: Rgb(150, 102, 15),
            warning_soft: Rgb(242, 237, 226),

            danger: Rgb(180, 40, 40),
            danger_soft: Rgb(246, 229, 229),
            on_danger: Rgb::WHITE,

            info: Rgb(14, 116, 144),
            info_soft: Rgb(226, 238, 242),

            red: Rgb(180, 40, 40),
            orange: Rgb(180, 83, 9),
            yellow: Rgb(150, 102, 15),
            green: Rgb(47, 111, 79),
            cyan: Rgb(14, 116, 144),
            blue: Rgb(30, 90, 160),
            violet: Rgb(109, 79, 160),

            code: Rgb(246, 248, 250),
        }
    }
}

#[wasm_bindgen]
impl ThemeColors {
    #[must_use]
    #[allow(clippy::missing_const_for_fn, clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn new(
        surface: Rgb,
        surface2: Rgb,
        surface3: Rgb,

        border: Rgb,
        border_strong: Rgb,

        text: Rgb,
        text_secondary: Rgb,

        accent: Rgb,
        accent_soft: Rgb,
        on_accent: Rgb,

        ok: Rgb,
        ok_soft: Rgb,

        warning: Rgb,
        warning_soft: Rgb,

        danger: Rgb,
        danger_soft: Rgb,
        on_danger: Rgb,

        info: Rgb,
        info_soft: Rgb,

        red: Rgb,
        orange: Rgb,
        yellow: Rgb,
        green: Rgb,
        cyan: Rgb,
        blue: Rgb,
        violet: Rgb,

        code: Rgb,
    ) -> Self {
        Self {
            surface,
            surface2,
            surface3,

            border,
            border_strong,

            text,
            text_secondary,

            accent,
            accent_soft,
            on_accent,

            ok,
            ok_soft,

            warning,
            warning_soft,

            danger,
            danger_soft,
            on_danger,

            info,
            info_soft,

            red,
            orange,
            yellow,
            green,
            cyan,
            blue,
            violet,

            code,
        }
    }

    /// Generated tmTheme text, for writing into exported project bundles.
    #[must_use]
    #[wasm_bindgen(js_name = "tmTheme")]
    pub fn tm_theme_js(&self) -> String {
        self.tm_theme()
    }

    /// Virtual path of `tmTheme`, with no leading slash.
    #[must_use]
    #[wasm_bindgen(js_name = "tmThemePath")]
    pub fn tm_theme_path_js(&self) -> String {
        self.syntax_theme_path()
    }
}

impl fmt::Display for ThemeColors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "(surface:{},surface-2:{},surface-3:{},border:{},border-strong:{},text:{},text-secondary:{},accent:{},accent-soft:{},on-accent:{},ok:{},ok-soft:{},warning:{},warning-soft:{},danger:{},danger-soft:{},on-danger:{},info:{},info-soft:{},red:{},orange:{},yellow:{},green:{},cyan:{},blue:{},violet:{},code:{})",
            self.surface,
            self.surface2,
            self.surface3,
            self.border,
            self.border_strong,
            self.text,
            self.text_secondary,
            self.accent,
            self.accent_soft,
            self.on_accent,
            self.ok,
            self.ok_soft,
            self.warning,
            self.warning_soft,
            self.danger,
            self.danger_soft,
            self.on_danger,
            self.info,
            self.info_soft,
            self.red,
            self.orange,
            self.yellow,
            self.green,
            self.cyan,
            self.blue,
            self.violet,
            self.code,
        )
    }
}

impl ThemeColors {
    /// Every channel in slot order, for a stable path hash.
    fn channels(&self) -> [u8; 81] {
        let slots = [
            self.surface,
            self.surface2,
            self.surface3,
            self.border,
            self.border_strong,
            self.text,
            self.text_secondary,
            self.accent,
            self.accent_soft,
            self.on_accent,
            self.ok,
            self.ok_soft,
            self.warning,
            self.warning_soft,
            self.danger,
            self.danger_soft,
            self.on_danger,
            self.info,
            self.info_soft,
            self.red,
            self.orange,
            self.yellow,
            self.green,
            self.cyan,
            self.blue,
            self.violet,
            self.code,
        ];
        let mut out = [0u8; 81];
        for (index, color) in slots.iter().enumerate() {
            out[index * 3] = color.0;
            out[index * 3 + 1] = color.1;
            out[index * 3 + 2] = color.2;
        }

        out
    }

    /// FNV-1a over the palette, so the same theme always maps to the same
    /// virtual file path and different themes never collide.
    #[must_use]
    pub fn hash(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in self.channels() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }

        hash
    }

    /// Virtual path (project root, no leading slash) of the generated tmTheme.
    #[must_use]
    pub fn syntax_theme_path(&self) -> String {
        format!("typbase/syntax-{:016x}.tmTheme", self.hash())
    }

    /// A Sublime `.tmTheme` that colors code blocks with this palette.
    /// Scope names mirror Typst's default theme so every highlightable token
    /// keeps its scope, and only the colors change.
    #[must_use]
    pub fn tm_theme(&self) -> String {
        let foreground = self.text;
        let items = [
            ("comment", Some(self.text_secondary), None),
            ("constant.character.escape", Some(self.ok), None),
            ("markup.bold", None, Some("bold")),
            ("markup.italic", None, Some("italic")),
            ("markup.underline", None, Some("underline")),
            ("markup.raw", Some(self.text_secondary), None),
            ("string.other.math.typst", None, None),
            ("punctuation.definition.math", Some(self.ok), None),
            (
                "keyword.operator.math, punctuation.math.typst",
                Some(self.accent),
                None,
            ),
            ("markup.heading, entity.name.section", None, Some("bold")),
            ("markup.heading.typst", None, Some("bold underline")),
            ("punctuation.definition.list", Some(self.accent), None),
            ("markup.list.term", None, Some("bold")),
            (
                "entity.name.label, markup.other.reference",
                Some(self.accent),
                None,
            ),
            (
                "keyword, constant.language, variable.language",
                Some(self.accent),
                None,
            ),
            ("storage.type, storage.modifier", Some(self.accent), None),
            ("constant", Some(self.warning), None),
            ("string", Some(self.warning), None),
            (
                "entity.name, variable.function, support",
                Some(self.accent),
                None,
            ),
            ("support.macro", Some(self.accent), None),
            ("meta.annotation", Some(self.warning), None),
            ("entity.other, meta.interpolation", Some(self.accent), None),
            ("meta.diff.range", Some(self.accent), None),
            (
                "markup.inserted, meta.diff.header.to-file",
                Some(self.ok),
                None,
            ),
            (
                "markup.deleted, meta.diff.header.from-file",
                Some(self.danger),
                None,
            ),
            (
                "meta.mapping.key.json string.quoted.double.json",
                Some(self.accent),
                None,
            ),
            (
                "meta.mapping.value.json string.quoted.double.json",
                Some(self.warning),
                None,
            ),
        ];

        let mut settings = String::new();
        settings.push_str(&format!(
            "    <dict><key>settings</key><dict><key>foreground</key><string>{}</string><key>background</key><string>{}</string></dict></dict>\n",
            foreground.hex(),
            self.code.hex(),
        ));
        for (scope, color, style) in items {
            settings.push_str("    <dict><key>scope</key><string>");
            settings.push_str(scope);
            settings.push_str("</string><key>settings</key><dict>");
            if let Some(color) = color {
                settings.push_str(&format!(
                    "<key>foreground</key><string>{}</string>",
                    color.hex()
                ));
            }
            if let Some(style) = style {
                settings.push_str(&format!("<key>fontStyle</key><string>{style}</string>"));
            }
            settings.push_str("</dict></dict>\n");
        }

        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple Computer//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>name</key><string>typbase</string>\n  <key>settings</key>\n  <array>\n{settings}  </array>\n</dict>\n</plist>\n"
        )
    }
}

impl Rgb {
    /// `#rrggbb` for tmTheme files.
    fn hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }
}

#[allow(clippy::unsafe_derive_deserialize)]
#[derive(Default, Debug, Clone, Copy, Hash, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct Rgb(u8, u8, u8);

impl Rgb {
    pub const BLACK: Self = Self(0, 0, 0);
    pub const WHITE: Self = Self(255, 255, 255);
}

#[wasm_bindgen]
impl Rgb {
    #[must_use]
    #[allow(clippy::missing_const_for_fn)]
    #[wasm_bindgen(constructor)]
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self(r, g, b)
    }

    #[must_use]
    #[wasm_bindgen(js_name = toString)]
    pub fn to_js_string(&self) -> String {
        format!("rgb({},{},{})", self.0, self.1, self.2)
    }
}

impl fmt::Display for Rgb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "rgb({},{},{})", self.0, self.1, self.2)
    }
}
