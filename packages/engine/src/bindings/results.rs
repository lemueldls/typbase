use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    bindings::TypstDiagnostic,
    renderer::{html::HTMLRangedFrame, paged::svg::SvgRangedFrame},
    world::TypstRequest,
};

#[derive(Tsify, Serialize, Deserialize)]
pub struct CompilePagedResult {
    pub frames: Vec<SvgRangedFrame>,
    /// The definitions `frames` reference, for the host to place in the document.
    /// The frames are not self-contained without it.
    pub defs: Option<String>,
    /// Equation overlays, narrowed to the equation the caret is inside when the
    /// caller passed one.
    pub tooltips: Vec<SvgRangedFrame>,
    /// UTF-16 ranges of every equation in the note, whether or not its overlay
    /// was rendered. The editor compares the cursor against these to know when
    /// it has entered math whose overlay the last render did not build.
    pub equation_ranges: Vec<[usize; 2]>,
    pub diagnostics: Vec<TypstDiagnostic>,
    pub requests: Vec<TypstRequest>,
}

#[derive(Tsify, Serialize, Deserialize)]
pub struct CompileHTMLResult {
    pub frames: Vec<HTMLRangedFrame>,
    pub diagnostics: Vec<TypstDiagnostic>,
    pub requests: Vec<TypstRequest>,
}

#[derive(Tsify, Serialize, Deserialize)]
pub struct CheckResult {
    pub diagnostics: Vec<TypstDiagnostic>,
    pub requests: Vec<TypstRequest>,
}

#[cfg(feature = "pdf")]
#[derive(Tsify, Serialize, Deserialize)]
pub struct RenderPdfResult {
    pub bytes: Option<Vec<u8>>,
    pub diagnostics: Vec<TypstDiagnostic>,
    pub requests: Vec<TypstRequest>,
}

/// SVG export: one string per page, or a single merged document.
#[derive(Tsify, Serialize, Deserialize)]
pub struct RenderSvgResult {
    pub pages: Vec<String>,
    pub diagnostics: Vec<TypstDiagnostic>,
    pub requests: Vec<TypstRequest>,
}
