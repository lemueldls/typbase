use std::{
    io::{Cursor, Read},
    num::NonZeroUsize,
    path::PathBuf,
    str::FromStr,
};

use ecow::EcoVec;
use indoc::formatdoc;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use tar::Archive;
use tsify::{Ts, Tsify};
use typst::{
    compile,
    ecow::EcoString,
    foundations::Bytes,
    introspection::{HtmlPosition, PagedPosition},
    layout::{Abs, Point},
    syntax::{FileId, VirtualPath, package::PackageSpec},
};
use typst_html::{HtmlDocument, HtmlOptions};
use typst_ide::Tooltip;
use typst_layout::PagedDocument;
// use typst_html::html;
// use typst_pdf::{PdfOptions, pdf};
use typst_svg::SvgOptions;
use typst_syntax::{LinkedNode, RootedPath, Side, Source, Tag, VirtualRoot};
use wasm_bindgen::prelude::*;

#[cfg(feature = "pdf")]
use crate::bindings::RenderPdfResult;
use crate::{
    bindings::{
        CheckResult, CompileHTMLResult, CompilePagedResult, RenderSvgResult, TypstCompletion,
        TypstDiagnostic, TypstFileId, TypstHighlight, TypstJump,
    },
    flatten::{FlattenedBlock, SectionSpan},
    renderer::{
        html::{self, RenderHtmlResult},
        paged::svg::render_svgs_by_items,
        recovery::remove_errornous_block,
    },
    source::{RenderTarget, SourceContext, SpaceContext, SynthResult, sync_source_state},
    theme::ThemeColors,
    world::TypstWorld,
};

/// Global state for Typst rendering and compilation in typbase.
///
/// Holds the world, all open source and space contexts, and manages the mapping
/// between user/editor state and Typst's compilation model.
#[wasm_bindgen]
#[derive(Default, Debug)]
pub struct TypstState {
    /// The Typst world, containing all loaded files and fonts.
    pub(crate) world: TypstWorld,
    /// Mapping from space IDs to their context (fonts, theme, locale).
    pub(crate) space_context_map: FxHashMap<String, SpaceContext>,
    /// Mapping from file IDs to their source context (main/raw sources, index
    /// mapping, etc).
    pub(crate) source_context_map: FxHashMap<TypstFileId, SourceContext>,
    /// Bumped whenever fonts, theme, or font settings change. The editor keys
    /// its compile cache on it, so installing system fonts mid-session makes
    /// open documents re-render.
    pub(crate) revision: u32,
}

#[wasm_bindgen]
impl TypstState {
    #[must_use]
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut this = Self::default();

        let id = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new("typbase/lib.typ").expect("Invalid virtual path"),
        ));
        this.world.insert_source(id, String::from(TYPBASE_LIB));

        this
    }

    #[wasm_bindgen(js_name = "setTheme")]
    pub fn set_theme(&mut self, id: &TypstFileId, theme: ThemeColors) {
        self.get_space_context_mut(id).theme = theme;
        self.revision += 1;
    }

    #[wasm_bindgen(js_name = "setFont")]
    pub fn set_font(&mut self, id: &TypstFileId, font: String) {
        self.get_space_context_mut(id).font = font;
        self.revision += 1;
    }

    #[wasm_bindgen(js_name = "setMathFont")]
    pub fn set_math_font(&mut self, id: &TypstFileId, math_font: Option<String>) {
        self.get_space_context_mut(id).math_font = math_font;
        self.revision += 1;
    }

    #[wasm_bindgen(js_name = "setCodeFont")]
    pub fn set_code_font(&mut self, id: &TypstFileId, code_font: Option<String>) {
        self.get_space_context_mut(id).code_font = code_font;
        self.revision += 1;
    }

    #[wasm_bindgen(js_name = "setTextSize")]
    pub fn set_text_size(&mut self, id: &TypstFileId, text_size: f64) {
        self.get_space_context_mut(id).text_size = text_size;
        self.revision += 1;
    }

    #[wasm_bindgen(js_name = "setLocale")]
    pub fn set_locale(&mut self, id: &TypstFileId, locale: String) {
        self.get_space_context_mut(id).locale = locale;
        self.revision += 1;
    }

    /// Monotonic counter bumped on font/theme/config changes. Re-render
    /// decisions key on this, not on the file path alone.
    #[wasm_bindgen(js_name = "revision")]
    #[must_use]
    pub fn revision(&self) -> u32 {
        self.revision
    }

    /// Drains and returns the most recent panic message, if any. JS calls
    /// this right after a call into the wasm boundary throws: a panic on
    /// wasm32-unknown-unknown aborts the instance (no unwinding), so the
    /// caller must recreate the state and retry.
    #[wasm_bindgen(js_name = "takePanic")]
    #[must_use]
    pub fn take_panic(&self) -> Option<String> {
        crate::utils::take_panic()
    }

    /// Current WASM heap size in bytes. The lab watches this to catch leaks;
    /// the wasm allocator rarely returns memory to the browser, so growth
    /// here usually means a compile loop.
    #[wasm_bindgen(js_name = "memoryBytes")]
    #[must_use]
    pub fn memory_bytes(&self) -> u32 {
        let memory = wasm_bindgen::memory();
        let buffer = js_sys::Reflect::get(&memory, &"buffer".into()).ok();
        let length = buffer
            .as_ref()
            .and_then(|buffer| js_sys::Reflect::get(buffer, &"byteLength".into()).ok());
        length
            .and_then(|length| length.as_f64())
            .unwrap_or_default() as u32
    }

    #[wasm_bindgen(js_name = "createSourceId")]
    pub fn create_source_id(&mut self, path: &str, space_id: String) -> TypstFileId {
        let id = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new(path)
                .expect("Invalid virtual path")
                .with_extension("typ"),
        ));
        let id_wrapper = TypstFileId::new(id);

        let source_ctx = SourceContext::new(id, space_id.clone());
        self.world.insert_source(source_ctx.raw_id, String::new());
        self.world.insert_source(source_ctx.synth_id, String::new());
        self.world
            .insert_source(source_ctx.render_id, String::new());
        self.world.insert_source(source_ctx.ide_id, String::new());
        self.source_context_map.insert(id_wrapper, source_ctx);

        // The space context is workspace-shared: fonts/theme are applied to it
        // once. Creating another source id in the same workspace must keep the
        // existing context (with its theme), or the styles silently reset and
        // pages render default-black until something re-applies them.
        self.space_context_map
            .entry(space_id.clone())
            .or_insert_with(SpaceContext::new);

        id_wrapper
    }

    #[wasm_bindgen(js_name = "createFileId")]
    pub fn create_file_id(&mut self, path: &str) -> TypstFileId {
        let id = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new(path).expect("Invalid virtual path"),
        ));

        TypstFileId::new(id)
    }

    #[wasm_bindgen(js_name = "insertSource")]
    pub fn insert_source(&mut self, id: &TypstFileId, text: String) {
        self.world.insert_source(id.inner(), text);
    }

    #[wasm_bindgen(js_name = "insertFile")]
    pub fn insert_file(&mut self, id: &TypstFileId, bytes: Vec<u8>) {
        self.world.insert_file(id.inner(), Bytes::new(bytes));
    }

    #[wasm_bindgen(js_name = "removeFile")]
    pub fn remove_file(&mut self, id: &TypstFileId) {
        // For a note, drop the context and every source file it owns. Leaving
        // the raw and render files behind used to leak one entry per closed
        // note. Plain project files (requests the caller satisfied by hand)
        // have no context and are removed as-is.
        if let Some(context) = self.source_context_map.remove(id) {
            self.world.remove_source(&context.synth_id);
            self.world.remove_source(&context.raw_id);
            self.world.remove_source(&context.render_id);
            self.world.remove_source(&context.ide_id);
        } else {
            self.world.remove_source(&id.inner());
        }
    }

    #[wasm_bindgen(js_name = "installPackage")]
    pub fn install_package(&mut self, spec: &str, data: Vec<u8>) -> Result<(), JsValue> {
        let package_spec =
            Some(PackageSpec::from_str(spec).map_err(|e| JsValue::from_str(&e.to_string()))?);

        let data = Cursor::new(data);
        let data = flate2::read::GzDecoder::new(data);
        let mut archive = Archive::new(data);

        for entry in archive.entries().unwrap() {
            let mut file = entry.unwrap();
            let path = file.path().unwrap();

            let root = match &package_spec {
                Some(spec) => VirtualRoot::Package(spec.clone()),
                None => VirtualRoot::Project,
            };

            let id = FileId::new(RootedPath::new(
                root,
                VirtualPath::new(path.to_str().expect("Invalid virtual path"))
                    .expect("Invalid virtual path"),
            ));

            let mut content = Vec::new();
            file.read_to_end(&mut content).unwrap();

            match String::from_utf8(content.clone()) {
                Ok(content) => self.world.insert_source(id, content),
                Err(..) => self.world.insert_file(id, Bytes::new(content)),
            }
        }

        Ok(())
    }

    #[wasm_bindgen(js_name = "installFont")]
    pub fn install_font(&mut self, bytes: Vec<u8>) {
        self.world.install_font(bytes);
        self.revision += 1;
    }

    /// Index mapping self-test for the debug lab. Builds the synth exactly
    /// like a compile would, then verifies mapper invariants: anchors in
    /// bounds, raw->synth monotonic, synth->raw always inside the raw source.
    #[wasm_bindgen(js_name = "checkIndex")]
    pub fn check_index(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<IndexCheckReport>, JsError> {
        let report = self.check_index_report(id, text, prelude);

        Ok(report.into_ts()?)
    }
}

impl TypstState {
    /// Plain-Rust core of [`Self::check_index`]. Host tests call this
    /// directly; the wasm boundary only serializes the report.
    #[must_use]
    pub fn check_index_report(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> IndexCheckReport {
        let SynthResult { .. } = sync_source_state(id, text, prelude, RenderTarget::Svg, self);

        let context = self.source_context_map.get_mut(id).unwrap();
        let mapper = &context.index_mapper;
        let raw_len = text.len();
        let synth_len = context
            .synth_source(&self.world)
            .map(|source| source.text().len())
            .unwrap_or_default();

        let mut checked = 0_u32;
        let mut mismatches: Vec<String> = Vec::new();

        let anchors = mapper.anchors();

        // Anchors must sit inside their own coordinate spaces, and both axes
        // must be non-decreasing in insertion order (equal is fine: block
        // boundaries and wrapper marks share positions). A regression means a
        // push was attached in the wrong order, and the tags say which one.
        let mut last_raw = 0;
        let mut last_synth = 0;
        for (index, anchor) in anchors.iter().enumerate() {
            if anchor.raw > raw_len {
                mismatches.push(format!(
                    "anchor {index} ({}): raw {} beyond raw_len {raw_len}",
                    anchor.kind.label(),
                    anchor.raw
                ));
            }
            if anchor.synth > synth_len {
                mismatches.push(format!(
                    "anchor {index} ({}): synth {} beyond synth_len {synth_len}",
                    anchor.kind.label(),
                    anchor.synth
                ));
            }
            if index > 0 {
                if anchor.raw < last_raw {
                    mismatches.push(format!(
                        "anchor {index} ({}): raw regressed to {} after {} ({})",
                        anchor.kind.label(),
                        anchor.raw,
                        last_raw,
                        anchors[index - 1].kind.label(),
                    ));
                }
                if anchor.synth < last_synth {
                    mismatches.push(format!(
                        "anchor {index} ({}): synth regressed to {} after {} ({})",
                        anchor.kind.label(),
                        anchor.synth,
                        last_synth,
                        anchors[index - 1].kind.label(),
                    ));
                }
            }
            last_raw = anchor.raw;
            last_synth = anchor.synth;
        }

        let anchor_report = anchors
            .iter()
            .map(|anchor| CheckedAnchor {
                raw: anchor.raw as u32,
                synth: anchor.synth as u32,
                kind: anchor.kind.label().to_string(),
            })
            .collect();

        let step = (raw_len / 400).max(1);

        // raw -> synth must be monotonic over the whole raw range. Wrapper
        // anchors tie raw positions with different synth offsets, so a
        // one-byte dip at block boundaries is expected.
        let mut last_left = 0;
        let mut last_right = 0;
        for raw in (0..=raw_len).step_by(step) {
            let left = context.map_raw_to_synth_from_left(raw);
            let right = context.map_raw_to_synth_from_right(raw);

            if left > synth_len {
                mismatches.push(format!("raw->synth left overflow at {raw}: {left}"));
            }
            if right > synth_len {
                mismatches.push(format!("raw->synth right overflow at {raw}: {right}"));
            }
            if raw > 0 {
                if left + 1 < last_left {
                    mismatches.push(format!(
                        "raw->synth left regressed at {raw}: {left} < {last_left}"
                    ));
                }
                if right + 1 < last_right {
                    mismatches.push(format!(
                        "raw->synth right regressed at {raw}: {right} < {last_right}"
                    ));
                }
            }
            last_left = left;
            last_right = right;
            checked += 1;
        }

        // synth -> raw must never leave the raw source (including prelude
        // positions, which map to raw 0).
        let synth_step = (synth_len / 400).max(1);
        for synth_byte in (0..synth_len).step_by(synth_step) {
            let left = context.map_synth_to_raw_from_left(synth_byte);
            let right = context.map_synth_to_raw_from_right(synth_byte);

            if left > raw_len {
                mismatches.push(format!("synth->raw left overflow at {synth_byte}: {left}"));
            }
            if right > raw_len {
                mismatches.push(format!(
                    "synth->raw right overflow at {synth_byte}: {right}"
                ));
            }
            checked += 1;
        }

        // Anchors must round-trip in at least one direction.
        for anchor in mapper.anchors() {
            let left = context.map_synth_to_raw_from_left(anchor.synth);
            let right = context.map_synth_to_raw_from_right(anchor.synth);

            if left != anchor.raw && right != anchor.raw {
                mismatches.push(format!(
                    "anchor ({} at raw {}, synth {}) round-trip failed: left {left}, right {right}",
                    anchor.kind.label(),
                    anchor.raw,
                    anchor.synth,
                ));
            }
        }

        IndexCheckReport {
            ok: mismatches.is_empty(),
            checked,
            mismatches,
            anchors: anchor_report,
        }
    }

    /// Plain-Rust core of [`Self::jump_paged`].
    pub fn jump_paged_at(&self, id: &TypstFileId, x: f64, mut y: f64) -> Option<TypstJump> {
        let context = self.source_context_map.get(id)?;
        let document = context.paged_document.as_ref()?;

        let index = document
            .pages()
            .iter()
            .rposition(|page| y >= page.frame.height().to_pt())
            .unwrap_or_default();

        let page_offset = document
            .pages()
            .iter()
            .map(|page| page.frame.height().to_pt())
            .rfind(|height| y >= *height)
            .unwrap_or_default();
        y -= page_offset;

        let position = PagedPosition {
            page: NonZeroUsize::new(index + 1).unwrap(),
            point: Point::new(Abs::pt(x), Abs::pt(y)),
        };

        typst_ide::jump_from_click(&self.world, document, &position)
            .and_then(|jump| TypstJump::from_mapped(jump, context, &self.world))
    }

    /// Plain-Rust core of [`Self::jump_html`].
    pub fn jump_html_at(&self, id: &TypstFileId, element: Vec<usize>) -> Option<TypstJump> {
        let context = self.source_context_map.get(id)?;
        let document = context.html_document.as_ref()?;

        typst_ide::jump_from_click(
            &self.world,
            document,
            &HtmlPosition::new(EcoVec::from(element)),
        )
        .and_then(|jump| TypstJump::from_mapped(jump, context, &self.world))
    }

    /// Picks the parse source and `World::main` for an IDE query at a raw
    /// cursor.
    ///
    /// Inside a range error recovery marked, the token under the cursor only
    /// exists in the pristine file (the patched trace file has a placeholder
    /// there), so parse that and give up on trace-based resolution, which
    /// needs a compilable main. Everywhere else the patched file is used: it
    /// is byte-identical to the pristine one outside the marks and it
    /// compiles, so tracing resolves property access.
    fn ide_query_sources(&self, id: &TypstFileId, raw_cursor: usize) -> Option<(FileId, Source)> {
        let context = self.source_context_map.get(id)?;

        let inside_marked = context
            .marked_raw_ranges
            .iter()
            .any(|range| range.start <= raw_cursor && raw_cursor <= range.end);

        if inside_marked {
            Some((context.synth_id, context.synth_source(&self.world)?.clone()))
        } else {
            Some((context.ide_id, context.ide_source(&self.world)?.clone()))
        }
    }

    /// Plain-Rust core of [`Self::autocomplete`].
    pub fn autocomplete_at(
        &mut self,
        id: &TypstFileId,
        raw_cursor_utf16: usize,
        explicit: bool,
    ) -> Option<Autocomplete> {
        let synth_id = self.source_context_map.get(id)?.synth_id;
        let raw_source = self.source_context_map.get(id)?.raw_source(&self.world)?;
        let raw_cursor = raw_source.lines().utf16_to_byte(raw_cursor_utf16)?;

        let (main_id, parse_source) = self.ide_query_sources(id, raw_cursor)?;

        self.world.main_id = Some(main_id);

        let result = (|| {
            let context = self.source_context_map.get(id)?;

            let raw_source = context.raw_source(&self.world)?;
            let raw_lines = raw_source.lines();
            let raw_cursor = raw_lines.utf16_to_byte(raw_cursor_utf16)?;
            let synth_cursor = context.map_raw_to_synth_from_left(raw_cursor);

            let (synth_offset, completions) = typst_ide::autocomplete(
                &self.world,
                context.paged_document.as_ref(),
                &parse_source,
                synth_cursor,
                explicit,
            )?;

            let raw_offset = context.map_synth_to_raw_from_left(synth_offset);
            let raw_offset_utf16 = raw_lines.byte_to_utf16(raw_offset)?;

            Some(Autocomplete {
                offset: raw_offset_utf16,
                completions: completions
                    .into_iter()
                    .map(TypstCompletion::from)
                    .collect::<Box<[_]>>(),
            })
        })();

        self.world.main_id = Some(synth_id);

        result
    }
}

#[wasm_bindgen]
impl TypstState {
    fn process_requests(&self) -> Vec<TypstRequest> {
        let mut requests = Vec::new();

        self.world.requested_sources.retain(|source| {
            requests.push(TypstRequest::Source(PathBuf::from(source.get_with_slash())));
            false
        });

        self.world.requested_files.retain(|file| {
            requests.push(TypstRequest::File(PathBuf::from(file.get_with_slash())));
            false
        });

        self.world.requested_packages.retain(|package| {
            requests.push(TypstRequest::Package {
                namespace: package.namespace.to_string(),
                name: package.name.to_string(),
                version: package.version.to_string(),
            });

            false
        });

        requests
    }

    #[wasm_bindgen(js_name = "compilePaged")]
    pub fn compile_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CompilePagedResult>, JsError> {
        let result = render_svgs_by_items(id, text, prelude, self);

        Ok(CompilePagedResult {
            frames: result.frames,
            tooltips: result.tooltips,
            diagnostics: result.diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    #[wasm_bindgen(js_name = "compileHTML")]
    pub fn compile_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CompileHTMLResult>, JsError> {
        let result = html::render(id, text, prelude, self);

        Ok(CompileHTMLResult {
            frames: result.frames,
            diagnostics: result.diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    /// Plain-text flattening per block for the search index, plus the byte
    /// map back to raw source. Pure syntax pass; no state needed.
    #[wasm_bindgen(js_name = "flattenDocument")]
    pub fn flatten_document(&self, text: &str) -> Result<Vec<Ts<FlattenedBlock>>, JsError> {
        Ok(crate::flatten::flatten_document(text)
            .into_iter()
            .map(|block| block.into_ts())
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Extracts `#typbase.section` spans for the page doc's sections list.
    #[wasm_bindgen(js_name = "extractSections")]
    pub fn extract_sections(&self, text: &str) -> Result<Vec<Ts<SectionSpan>>, JsError> {
        Ok(crate::flatten::extract_sections(text)
            .into_iter()
            .map(|span| span.into_ts())
            .collect::<Result<Vec<_>, _>>()?)
    }

    #[wasm_bindgen(js_name = "checkPaged")]
    pub fn check_paged(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CheckResult>, JsError> {
        // Diagnostics-only pass: compile the pristine synth, no recovery.
        sync_source_state(id, text, prelude, RenderTarget::Svg, self);

        let context = self.source_context_map.get_mut(id).unwrap();

        let compiled = compile::<PagedDocument>(&self.world);
        let compiled_warnings = Some(compiled.warnings);

        let mut diagnostics = Vec::new();

        if let Some(warnings) = compiled_warnings {
            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                warnings,
                context,
                &self.world,
            ));
        }

        match compiled.output {
            Ok(document) => {
                context.paged_document = Some(document);
            }
            Err(source_diagnostics) => {
                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics,
                    context,
                    &self.world,
                ));
            }
        }

        Ok(CheckResult {
            diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    #[wasm_bindgen(js_name = "checkHTML")]
    pub fn check_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<CheckResult>, JsError> {
        // Diagnostics-only pass: compile the pristine synth, no recovery.
        sync_source_state(id, text, prelude, RenderTarget::Html, self);

        let context = self.source_context_map.get_mut(id).unwrap();

        let compiled = compile::<HtmlDocument>(&self.world);
        let compiled_warnings = Some(compiled.warnings);

        let mut diagnostics = Vec::new();

        if let Some(warnings) = compiled_warnings {
            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                warnings,
                context,
                &self.world,
            ));
        }

        match compiled.output {
            Ok(document) => {
                context.html_document = Some(document);
            }
            Err(source_diagnostics) => {
                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics,
                    context,
                    &self.world,
                ));
            }
        }

        Ok(CheckResult {
            diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    #[wasm_bindgen]
    pub fn highlight(
        &mut self,
        id: &TypstFileId,
        text: &str,
    ) -> Result<Vec<Ts<TypstHighlight>>, JsError> {
        let Some(context) = self.source_context_map.get(id) else {
            return Ok(Vec::new());
        };

        let root = typst_syntax::parse(text);
        let Some(raw_source) = context.raw_source_mut(&mut self.world) else {
            return Ok(Vec::new());
        };
        raw_source.replace(text);

        let mut queue = vec![LinkedNode::new(&root)];
        let mut highlights = Vec::new();

        let raw_lines = raw_source.lines();

        while let Some(curr) = queue.pop() {
            let tag = typst_syntax::highlight(&curr);
            let range = curr.range();

            let highlight = tag.and_then(|tag| {
                let raw_range_start_utf16 = raw_lines.byte_to_utf16(range.start)?;
                let raw_range_end_utf16 = raw_lines.byte_to_utf16(range.end)?;
                let raw_range_utf16 = raw_range_start_utf16..raw_range_end_utf16;

                let mut css_class = tag.css_class().to_string();

                if tag == Tag::Heading {
                    let node = curr.get();

                    let Some(marker_node) = node.children().next() else {
                        unreachable!()
                    };
                    let level = marker_node.leaf_text().len();

                    css_class += " typ-heading-level-";
                    css_class += level.to_string().as_str();
                }

                Some(TypstHighlight {
                    tag: css_class,
                    range: raw_range_utf16,
                })
            });

            if let Some(highlight) = highlight {
                let idx = highlights
                    .binary_search_by_key(&highlight.range.start, |highlight: &TypstHighlight| {
                        highlight.range.start
                    });

                match idx {
                    Ok(idx) | Err(idx) => highlights.insert(idx, highlight),
                }
            }

            for child in curr.children() {
                queue.push(child);
            }
        }

        Ok(highlights
            .into_iter()
            .map(|highlight| highlight.into_ts())
            .collect::<Result<Vec<_>, _>>()?)
    }

    #[wasm_bindgen(js_name = "jumpPaged")]
    pub fn jump_paged(
        &mut self,
        id: &TypstFileId,
        x: f64,
        y: f64,
    ) -> Result<Option<Ts<TypstJump>>, JsError> {
        Ok(self
            .jump_paged_at(id, x, y)
            .map(|jump| jump.into_ts())
            .transpose()?)
    }

    #[wasm_bindgen(js_name = "jumpHTML")]
    pub fn jump_html(
        &mut self,
        id: &TypstFileId,
        element: Vec<usize>,
    ) -> Result<Option<Ts<TypstJump>>, JsError> {
        Ok(self
            .jump_html_at(id, element)
            .map(|jump| jump.into_ts())
            .transpose()?)
    }

    #[wasm_bindgen]
    pub fn autocomplete(
        &mut self,
        id: &TypstFileId,
        raw_cursor_utf16: usize,
        explicit: bool,
    ) -> Result<Option<Ts<Autocomplete>>, JsError> {
        Ok(self
            .autocomplete_at(id, raw_cursor_utf16, explicit)
            .map(|value| value.into_ts())
            .transpose()?)
    }

    #[wasm_bindgen]
    pub fn hover(&mut self, id: &TypstFileId, raw_cursor_utf16: usize, side: i8) -> Option<String> {
        let synth_id = self.source_context_map.get(id)?.synth_id;
        let raw_cursor = {
            let raw_source = self.source_context_map.get(id)?.raw_source(&self.world)?;
            raw_source.lines().utf16_to_byte(raw_cursor_utf16)?
        };

        let (main_id, parse_source) = self.ide_query_sources(id, raw_cursor)?;

        self.world.main_id = Some(main_id);

        let result = (|| {
            let context = self.source_context_map.get(id)?;

            let raw_source = context.raw_source(&self.world)?;
            let raw_lines = raw_source.lines();
            let raw_cursor = raw_lines.utf16_to_byte(raw_cursor_utf16)?;
            let synth_cursor = context.map_raw_to_synth_from_right(raw_cursor);

            let side = if side == -1 {
                Side::Before
            } else {
                Side::After
            };

            let tooltip = typst_ide::tooltip(
                &self.world,
                context.paged_document.as_ref(),
                &parse_source,
                synth_cursor,
                side,
            );

            tooltip.map(|tooltip| match tooltip {
                Tooltip::Text(text) => text.to_string(),
                Tooltip::Code(text) => typst_syntax::highlight_html(&typst_syntax::parse(&text)),
            })
        })();

        self.world.main_id = Some(synth_id);

        result
    }

    #[wasm_bindgen]
    pub fn resize(&mut self, id: &TypstFileId, width: Option<f64>, height: Option<f64>) -> bool {
        let context = self.source_context_map.get_mut(id).unwrap();

        // Callers measure panes in CSS pixels. The app treats a Typst point as
        // one screen pixel: a 600px pane compiles as a 600pt page, and frames
        // then render at 1px per pt inside the pane, so a 16pt body matches
        // the editor's 16px. Converting px to true pt (x0.75) would lay out a
        // 600pt page and stretch it back over 600px, rendering everything 4/3
        // larger than the editor.
        let width = width
            .map(|px| px.to_string() + "pt")
            .unwrap_or_else(|| String::from("auto"));
        let width_changed = context.width != width;

        context.width = width;
        context.height = height;

        width_changed
    }

    /// PDF publishing, compiled only when the `pdf` cargo feature is on.
    /// Returns the PDF bytes plus diagnostics; the caller uploads the bytes
    /// as a blob on `app.typbase.post`.
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(js_name = "renderPdf")]
    pub fn render_pdf(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<RenderPdfResult>, JsError> {
        use typst_pdf::{PdfOptions, pdf};

        sync_source_state(id, text, prelude, RenderTarget::Pdf, self);

        let context = self.source_context_map.get_mut(id).unwrap();

        // Exports get the delimiter repair too; they compile the render source.
        self.world.main_id = Some(context.render_id);

        let compiled = compile::<PagedDocument>(&self.world);

        self.world.main_id = Some(context.synth_id);
        let mut diagnostics =
            TypstDiagnostic::from_diagnostics(compiled.warnings, context, &self.world).into_vec();

        let bytes = match compiled.output {
            Ok(document) => match pdf(&document, &PdfOptions::default()) {
                Ok(pdf) => Some(pdf),
                Err(source_diagnostics) => {
                    diagnostics.extend(TypstDiagnostic::from_diagnostics(
                        source_diagnostics,
                        context,
                        &self.world,
                    ));
                    None
                }
            },
            Err(source_diagnostics) => {
                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics,
                    context,
                    &self.world,
                ));
                None
            }
        };

        Ok(RenderPdfResult {
            bytes,
            diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    /// SVG export of the paged document: one entry per page, or a single
    /// merged document. Uses the PDF page geometry so the sheets match the
    /// PDF export; the caller sets the page width through `resize`.
    #[wasm_bindgen(js_name = "renderSvg")]
    pub fn render_svg(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
        merged: bool,
    ) -> Result<Ts<RenderSvgResult>, JsError> {
        sync_source_state(id, text, prelude, RenderTarget::Pdf, self);

        let context = self.source_context_map.get_mut(id).unwrap();

        // Same render source as the PDF export so the SVG sheets and the PDF
        // agree on page geometry and repaired delimiters.
        self.world.main_id = Some(context.render_id);

        let compiled = compile::<PagedDocument>(&self.world);

        self.world.main_id = Some(context.synth_id);
        let mut diagnostics =
            TypstDiagnostic::from_diagnostics(compiled.warnings, context, &self.world).into_vec();

        let pages = match compiled.output {
            Ok(document) => {
                let options = SvgOptions::default();
                if merged {
                    vec![typst_svg::svg_merged(&document, &options, Abs::pt(12.0))]
                } else {
                    document
                        .pages()
                        .iter()
                        .map(|page| typst_svg::svg(page, &options))
                        .collect()
                }
            }
            Err(source_diagnostics) => {
                diagnostics.extend(TypstDiagnostic::from_diagnostics(
                    source_diagnostics,
                    context,
                    &self.world,
                ));
                Vec::new()
            }
        };

        Ok(RenderSvgResult {
            pages,
            diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }

    /// The stdlib source as shipped, for writing a compilable project to disk.
    #[wasm_bindgen(js_name = "typbaseLib")]
    #[must_use]
    pub fn typbase_lib(&self) -> String {
        TYPBASE_LIB.to_string()
    }

    /// False when the shipped wasm build omits the pdf feature (the default).
    #[wasm_bindgen(js_name = "pdfAvailable")]
    #[must_use]
    pub fn pdf_available(&self) -> bool {
        cfg!(feature = "pdf")
    }

    #[wasm_bindgen(js_name = renderHtml)]
    pub fn render_html(
        &mut self,
        id: &TypstFileId,
        text: &str,
        prelude: &str,
    ) -> Result<Ts<RenderHtmlResult>, JsError> {
        let SynthResult { blocks, .. } =
            sync_source_state(id, text, prelude, RenderTarget::Html, self);

        let mut diagnostics = Vec::new();
        let mut compiled_warnings = None;

        let context = self.source_context_map.get_mut(id).unwrap();

        // Recovery blanks blocks of the render source; the pristine synth
        // stays available to the editor.
        self.world.main_id = Some(context.render_id);

        let mut document = None;
        let mut convergence = 0_u8;

        while document.is_none() {
            let compiled = compile::<HtmlDocument>(&self.world);
            compiled_warnings = Some(compiled.warnings);

            document = match compiled.output {
                Ok(document) => {
                    let html = typst_html::html(&document, &HtmlOptions::default());

                    match html {
                        Ok(html) => Some(html),
                        Err(source_diagnostics) => {
                            crate::error!("[HTML ERRORS]: {source_diagnostics:?}");

                            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                                source_diagnostics,
                                context,
                                &self.world,
                            ));

                            None
                        }
                    }
                }
                Err(source_diagnostics) => {
                    convergence += 1;
                    if convergence >= 128 {
                        crate::error!("COULD NOT CONVERGE ‼️");

                        break;
                    }

                    diagnostics.extend(TypstDiagnostic::from_diagnostics(
                        source_diagnostics.clone(),
                        context,
                        &self.world,
                    ));

                    crate::error!("[ERRORS]: {diagnostics:?}");

                    let indicies = remove_errornous_block(
                        &blocks,
                        &source_diagnostics,
                        context,
                        &mut self.world,
                    );

                    if indicies.is_empty() {
                        crate::error!("NO ERROR BLOCKS FOUND ‼️");

                        break;
                    }

                    None
                }
            };
        }

        self.world.main_id = Some(context.synth_id);

        if let Some(warnings) = compiled_warnings {
            diagnostics.extend(TypstDiagnostic::from_diagnostics(
                warnings,
                context,
                &self.world,
            ));
        }

        Ok(RenderHtmlResult {
            document,
            diagnostics,
            requests: self.process_requests(),
        }
        .into_ts()?)
    }
}

impl TypstState {
    pub const fn world(&self) -> &TypstWorld {
        &self.world
    }

    pub const fn world_mut(&mut self) -> &mut TypstWorld {
        &mut self.world
    }

    pub fn get_source_context(&self, id: &TypstFileId) -> &SourceContext {
        self.source_context_map.get(id).unwrap()
    }

    pub fn get_source_context_mut(&mut self, id: &TypstFileId) -> &mut SourceContext {
        self.source_context_map.get_mut(id).unwrap()
    }

    pub fn get_space_context(&self, id: &TypstFileId) -> &SpaceContext {
        let space_id = &self.get_source_context(id).space_id;
        self.space_context_map.get(space_id).unwrap()
    }

    pub fn get_space_context_mut(&mut self, id: &TypstFileId) -> &mut SpaceContext {
        let space_id = self.get_source_context(id).space_id.clone();
        self.space_context_map.get_mut(&space_id).unwrap()
    }
}

// The stdlib module, inserted into the world once at TypstState::new and
// imported by the generated prelude as `typbase`. `typbase.query` loads JSON
// the JS side synthesizes on demand (file request `/typbase/query/<kind>.json`);
// `typbase.embed` includes another page's source (source request
// `/typbase/src/<id>.typ`). Filters ride in the path because the request
// channel only carries paths, so keep filter values slug-safe.
//
// Paths are root-absolute so the same source compiles both in the wasm world
// and in a plain Typst project rooted at the workspace (see `sources/typbase`).
//
// It is a module rather than a dict of closures: Typst cannot call dict
// values with dot syntax (`typbase.query(...)`), but module functions can.
const TYPBASE_LIB: &str = r#"
#let query(kind, filter: none) = {
  let target = if filter == none {
    "/typbase/query/" + kind + ".json"
  } else {
    "/typbase/query/" + kind + "/" + str(filter) + ".json"
  }
  json(target)
}

#let embed(id) = include("/typbase/src/" + str(id) + ".typ")

// A navigable link to another page. Renders the page title (or the given
// body) as a Typst link; the app intercepts `typbase://page/<id>` clicks in
// the preview and opens that page for editing. Unlike embed, nothing is
// compiled at link time, and a missing page renders a quiet placeholder
// instead of failing the compile.
#let page-link(page-id, body: none) = {
  let meta = json("/typbase/query/pages/by-id/" + str(page-id) + ".json")
  if meta == none {
    if body == none [none] else [#body]
  } else {
    let url = "typbase://page/" + str(page-id)
    if body == none [#link(url)[#meta.title]] else [#link(url)[#body]]
  }
}

// A semantic block for app-side consumers (AI generation, flashcard decks).
// The body renders where it sits; the app reads kind and range off the AST.
#let section(kind: none, body) = body
"#;

// The import and the request paths are root-absolute: pages compile from
// `pages/<id>.typ`, so a relative import would resolve next to the page
// instead of at the workspace root.
const TYPBASE_PRELUDE: &str = r#"
    #import "/typbase/lib.typ" as typbase
"#;

#[comemo::track]
impl TypstState {
    pub fn prelude(&self, id: &TypstFileId, render_target: RenderTarget) -> String {
        let source_ctx = self.source_context_map.get(id).unwrap();
        let space_ctx = self.space_context_map.get(&source_ctx.space_id).unwrap();

        let page_config = match render_target {
            RenderTarget::Svg => {
                formatdoc!(
                    r#"
                        #set page(fill:rgb(0,0,0,0),width:{width},height:auto,margin:0pt)
                        #set text(top-edge:"ascender",bottom-edge:"descender")
                        #set par(leading:0.125em)
                    "#,
                    width = source_ctx.width,
                )
            }
            RenderTarget::Pdf => {
                formatdoc!(
                    r"
                        #set page(width:{width},height:auto,margin:16pt)
                    ",
                    width = source_ctx.width,
                )
            }
            RenderTarget::Html => formatdoc!(""),
        };

        formatdoc!(
            r#"
                #let theme={theme}
                #set text(fill:theme.text,size:{text_size}pt,lang:"{locale}",font:"{font}")

                #show heading.where(level:1):set text(fill:theme.accent,size:32pt,weight:400)
                #show heading.where(level:2):set text(fill:theme.text,size:28pt,weight:400)
                #show heading.where(level:3):set text(fill:theme.text-secondary,size:24pt,weight:400)
                #show heading.where(level:4):set text(fill:theme.accent,size:22pt,weight:400)
                #show heading.where(level:5):set text(fill:theme.text,size:16pt,weight:500)
                #show heading.where(level:6):set text(fill:theme.text-secondary,size:14pt,weight:500)

                #show link:set text(fill:theme.accent)
                #show link:underline

                #set line(stroke:theme.border)
                #set table(stroke:theme.border)
                #set circle(stroke:theme.border)
                #set ellipse(stroke:theme.border)
                #set line(stroke:theme.border)
                #set curve(stroke:theme.border)
                #set polygon(stroke:theme.border)
                #set rect(stroke:theme.border)
                #set square(stroke:theme.border)

                #show math.equation:set text(font:"{math_font}")
                #show math.equation.where(block:true):set text(size:18pt)
                #show math.equation.where(block:true):set par(leading:9pt)

                #show raw:set text(font:"{code_font}")

                #context {{show math.equation:set text(size:text.size*2)}}

                {typbase_prelude}

                {page_config}
            "#,
            typbase_prelude = TYPBASE_PRELUDE,
            text_size = space_ctx.text_size,
            font = space_ctx.font,
            math_font = space_ctx.math_font.as_ref().unwrap_or(&space_ctx.font),
            code_font = space_ctx.code_font.as_ref().unwrap_or(&space_ctx.font),
            locale = space_ctx.locale,
            theme = space_ctx.theme,
        )
    }
}

/// Result of `TypstState::check_index`: a self-test of the raw/synth mapping.
#[derive(Tsify, Serialize, Deserialize)]
pub struct IndexCheckReport {
    /// True when every checked invariant held.
    pub ok: bool,
    /// How many positions were sampled for each direction.
    pub checked: u32,
    /// Human-readable descriptions of failed invariants.
    pub mismatches: Vec<String>,
    /// Every anchor, tagged with its kind, for the debug lab.
    pub anchors: Vec<CheckedAnchor>,
}

/// One anchor in the check report, labelled for humans.
#[derive(Tsify, Serialize, Deserialize)]
pub struct CheckedAnchor {
    pub raw: u32,
    pub synth: u32,
    pub kind: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum TypstRequest {
    Source(PathBuf),
    File(PathBuf),
    Package {
        namespace: String,
        name: String,
        version: String,
    },
}

#[derive(Tsify, Serialize, Deserialize)]
pub struct TypstError(EcoString);

#[derive(Tsify, Serialize, Deserialize)]
pub struct Autocomplete {
    pub offset: usize,
    pub completions: Box<[TypstCompletion]>,
}
