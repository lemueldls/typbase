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
    pub tooltips: Vec<SvgRangedFrame>,
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
