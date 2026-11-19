//! Visible text and glyph boxes for the frames a paged render produced.
//!
//! The editor's SVG frames are glyph outlines, so the host has no text nodes to
//! search or highlight. This index keeps the layout's own text runs, their raw
//! source ranges, and their boxes in frame coordinates. The host builds page
//! search and exact highlights from it without re-reading the SVG.

use std::hash::{Hash, Hasher};

use ecow::{EcoString, EcoVec};
use rustc_hash::FxHasher;
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
    /// Hash of the frame geometry, runs, and glyph boxes. The host compares it
    /// before asking for the index again: same layout means the same rects.
    pub layout_hash: u32,
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

/// Hash of everything in a frame index that affects where visible text lands.
///
/// The source can stay the same while the layout moves: a pane resize, a font
/// swap, or plugin data feeding a query. The host reads this before asking for
/// the whole index, so it can keep the rects it already has.
#[must_use]
pub fn layout_hash(frames: &[FrameTextFrame]) -> u32 {
    let mut hasher = FxHasher::default();

    frames.len().hash(&mut hasher);

    for frame in frames {
        frame.from.hash(&mut hasher);
        frame.to.hash(&mut hasher);
        frame.runs.len().hash(&mut hasher);

        for run in &frame.runs {
            run.text.hash(&mut hasher);
            run.x.to_bits().hash(&mut hasher);
            run.y.to_bits().hash(&mut hasher);
            run.width.to_bits().hash(&mut hasher);
            run.height.to_bits().hash(&mut hasher);
            run.glyphs.len().hash(&mut hasher);

            for glyph in &run.glyphs {
                glyph.start.hash(&mut hasher);
                glyph.end.hash(&mut hasher);
                glyph.from.hash(&mut hasher);
                glyph.to.hash(&mut hasher);
                glyph.x.to_bits().hash(&mut hasher);
                glyph.width.to_bits().hash(&mut hasher);
            }
        }
    }

    #[allow(clippy::cast_possible_truncation)]
    let hash = hasher.finish() as u32;

    hash
}
