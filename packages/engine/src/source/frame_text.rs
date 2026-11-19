//! Visible text and glyph boxes for the frames a paged render produced.
//!
//! The editor's SVG frames are glyph outlines, so the host has no text nodes to
//! search or highlight. This index keeps the layout's own text runs, their raw
//! source ranges, and their boxes in frame coordinates. The host builds page
//! search and exact highlights from it without re-reading the SVG.

use ecow::{EcoString, EcoVec};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Text runs for every frame in the last paged render, in frame order.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone, Default)]
pub struct FrameText {
    #[tsify(type = "FrameTextFrame[]")]
    pub frames: EcoVec<FrameTextFrame>,
    /// FNV-1a hash of the raw source these frames were built from. The host
    /// compares it with its live text before trusting an index.
    pub source_hash: u32,
}

/// One frame's source range and visible text.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone)]
pub struct FrameTextFrame {
    /// Raw UTF-16 range of the chunk this frame renders.
    pub from: usize,
    pub to: usize,
    #[tsify(type = "FrameTextRun[]")]
    pub runs: EcoVec<FrameTextRun>,
}

/// One shaped text run inside a frame.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone)]
pub struct FrameTextRun {
    /// Visible text of the run, with glyph ranges indexing into it as UTF-16.
    #[tsify(type = "string")]
    pub text: EcoString,
    /// Left edge of the run in frame points. Points are CSS pixels here.
    pub x: f64,
    /// Top edge of the run in frame points.
    pub y: f64,
    /// Advance width of the run in frame points.
    pub width: f64,
    /// Line box height of the run in frame points.
    pub height: f64,
    #[tsify(type = "FrameTextGlyph[]")]
    pub glyphs: EcoVec<FrameTextGlyph>,
}

/// One glyph's text and box, plus the raw source range it came from.
#[derive(Tsify, Serialize, Deserialize, Debug, Clone)]
pub struct FrameTextGlyph {
    /// UTF-16 range in the run's text.
    pub start: usize,
    pub end: usize,
    /// Raw UTF-16 source range, when the glyph comes from this page.
    pub from: Option<usize>,
    pub to: Option<usize>,
    /// Left edge and advance width in frame points. Offset glyphs such as
    /// combining marks can extend past the run's nominal width.
    pub x: f64,
    pub width: f64,
}

/// FNV-1a hash of the raw source a frame index was built from.
#[must_use]
pub fn source_hash(text: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;

    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }

    hash
}
