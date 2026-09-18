use std::fmt;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Colors handed to Typst as the `theme` dictionary. The slots mirror the
/// app's `ThemePaletteTokens` one to one (plus derived `on-*` text colors), so
/// a single token set styles both the chrome and rendered pages. The dict keys
/// in [`fmt::Display`] are the kebab-case token names Typst code reads.
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
    warning: Rgb,

    danger: Rgb,
    danger_soft: Rgb,
    on_danger: Rgb,
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
            accent_soft: Rgb(227, 237, 248),
            on_accent: Rgb::WHITE,

            ok: Rgb(47, 111, 79),
            warning: Rgb(150, 102, 15),

            danger: Rgb(180, 40, 40),
            danger_soft: Rgb(249, 227, 227),
            on_danger: Rgb::WHITE,
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
        warning: Rgb,

        danger: Rgb,
        danger_soft: Rgb,
        on_danger: Rgb,
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
            warning,

            danger,
            danger_soft,
            on_danger,
        }
    }
}

impl fmt::Display for ThemeColors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "(surface:{},surface-2:{},surface-3:{},border:{},border-strong:{},text:{},text-secondary:{},accent:{},accent-soft:{},on-accent:{},ok:{},warning:{},danger:{},danger-soft:{},on-danger:{})",
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
            self.warning,
            self.danger,
            self.danger_soft,
            self.on_danger,
        )
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
