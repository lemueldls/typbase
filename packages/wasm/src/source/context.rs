use std::ops::Range;

use typst_html::HtmlDocument;
use typst_layout::PagedDocument;
use typst_syntax::{FileId, RootedPath, Source};

use crate::{
    source::{RawFixups, Side, SourceMap},
    theme::ThemeColors,
    world::TypstWorld,
};

/// Per-space configuration for rendering (fonts, theme, locale).
#[derive(Debug)]
pub struct SpaceContext {
    /// Default font for this space.
    pub font: String,
    /// Math font for this space.
    pub math_font: Option<String>,
    /// Code font for this space.
    pub code_font: Option<String>,
    /// Theme colors for this space.
    pub theme: ThemeColors,
    /// Locale for this space.
    pub locale: String,
    /// Body text size in points. Drives `#set text(size: ...)` in the
    /// generated prelude. One app pt is one screen px, so the default 16pt
    /// matches the editor's 16px source text.
    pub text_size: f64,
}

impl SpaceContext {
    #[must_use]
    pub fn new() -> Self {
        Self {
            font: String::from("Maple Mono"),
            math_font: Some(String::from("New Computer Modern Math")),
            code_font: Some(String::from("Maple Mono")),
            theme: ThemeColors::default(),
            locale: String::from("en"),
            text_size: 16.0,
        }
    }
}

impl Default for SpaceContext {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-note rendering context.
///
/// Holds four coordinate spaces and the offset maps between them:
///
/// - **raw**: exactly what the user typed, `raw_id`. Every position the editor
///   sees is in raw coordinates.
/// - **repaired**: the raw text with missing `$`/quote closers inserted,
///   tracked by [`RawFixups`]. Only needed for documents the parser would
///   otherwise swallow.
/// - **synth**: the pristine synthesized source, `synth_id`. Built from the
///   raw text on every sync. Never mutated after that; [`Self::index_map`]
///   describes it and diagnostics-only compiles read it.
/// - **render**: the disposable source the renderer compiles, `render_id`.
///   Built from the repaired text; error recovery marks and blanks ranges of
///   it and updates [`Self::render_map`] instead of touching the pristine
///   pair. IDE queries parse it too, because tracing an expression compiles
///   [`TypstWorld::main`], and the pristine synth of a page with errors does
///   not compile.
///
/// One `SourceContext` exists per open note. It is created by
/// [`TypstState::create_source_id`] and stored
/// in `TypstState::source_context_map`.
#[derive(Debug)]
pub struct SourceContext {
    /// File ID for the pristine synth. Built by `sync_source_context` on each
    /// recompile and never mutated afterwards.
    pub synth_id: FileId,

    /// File ID for the raw source: exactly what the user typed. Never modified
    /// by the renderer. All positions returned to the editor are in
    /// raw coordinates.
    pub raw_id: FileId,

    /// File ID for the render source: a copy of the synth (built from the
    /// repaired text) that error recovery is allowed to rewrite.
    pub render_id: FileId,

    /// File ID for the IDE trace source.
    ///
    /// Error recovery marks expressions that do not compile. `typst_ide`
    /// resolves field access by tracing values, and tracing compiles
    /// `world.main`, so IDE queries need a compilable main. This file is a
    /// byte-length-equal copy of the pristine synth with each marked range
    /// replaced by a valid expression. Queries outside the marked ranges parse
    /// this file and set `main` to it, so tracing works; queries inside a
    /// marked range parse the pristine synth instead, where the token under
    /// the cursor is still the user's.
    pub ide_id: FileId,

    /// Which space this note belongs to. Used to look up the associated
    /// [`SpaceContext`] for theme and font settings.
    pub space_id: String,

    /// Tracks the byte-offset correspondence between the raw source and the
    /// pristine synth. Rebuilt on each call to `sync_source_context`.
    pub index_map: SourceMap,

    /// Byte-offset correspondence between the repaired source and the render
    /// source. Cloned from [`Self::index_map`] when no repair was needed;
    /// error recovery splices its edits into this map.
    pub render_map: SourceMap,

    /// Delimiter insertions applied between raw and repaired text. Empty for
    /// the vast majority of notes.
    pub render_fixups: RawFixups,

    /// Raw ranges error recovery marked in the current render. Used to build
    /// the patched IDE trace source; cleared on every sync.
    pub marked_raw_ranges: Vec<Range<usize>>,

    /// The most recently compiled paged document for this note, if any.
    /// Cached here so hover and jump-to-source queries can avoid recompiling.
    pub paged_document: Option<PagedDocument>,

    /// The most recently compiled HTML document for this note, if any.
    pub html_document: Option<HtmlDocument>,

    /// Rendered page width, as a Typst dimension string (e.g. `"420pt"`
    /// or `"auto"`). Updated by [`TypstState::resize`].
    pub width: String,

    /// Maximum render height in points, if the note is in a fixed-height
    /// context (e.g. a locked sticky note). `None` for scrolling notes.
    pub height: Option<f64>,
}

impl SourceContext {
    #[must_use]
    pub fn new(synth_id: FileId, space_id: String) -> Self {
        let raw_id = FileId::new(RootedPath::new(
            synth_id.root().clone(),
            synth_id.vpath().with_extension("raw.typ"),
        ));
        let render_id = FileId::new(RootedPath::new(
            synth_id.root().clone(),
            synth_id.vpath().with_extension("render.typ"),
        ));
        let ide_id = FileId::new(RootedPath::new(
            synth_id.root().clone(),
            synth_id.vpath().with_extension("ide.typ"),
        ));

        Self {
            synth_id,
            raw_id,
            render_id,
            ide_id,
            space_id,
            index_map: SourceMap::default(),
            render_map: SourceMap::default(),
            render_fixups: RawFixups::default(),
            marked_raw_ranges: Vec::new(),
            paged_document: None,
            html_document: None,
            width: String::from("auto"),
            height: None,
        }
    }

    pub fn synth_source<'a>(&self, world: &'a TypstWorld) -> Option<&'a Source> {
        world.files.get(&self.synth_id)?.source()
    }

    pub fn synth_source_mut<'a>(&self, world: &'a mut TypstWorld) -> Option<&'a mut Source> {
        world.files.get_mut(&self.synth_id)?.source_mut()
    }

    pub fn raw_source<'a>(&self, world: &'a TypstWorld) -> Option<&'a Source> {
        world.files.get(&self.raw_id)?.source()
    }

    pub fn raw_source_mut<'a>(&self, world: &'a mut TypstWorld) -> Option<&'a mut Source> {
        world.files.get_mut(&self.raw_id)?.source_mut()
    }

    pub fn render_source<'a>(&self, world: &'a TypstWorld) -> Option<&'a Source> {
        world.files.get(&self.render_id)?.source()
    }

    pub fn render_source_mut<'a>(&self, world: &'a mut TypstWorld) -> Option<&'a mut Source> {
        world.files.get_mut(&self.render_id)?.source_mut()
    }

    pub fn ide_source<'a>(&self, world: &'a TypstWorld) -> Option<&'a Source> {
        world.files.get(&self.ide_id)?.source()
    }

    /// Rebuilds the patched IDE trace source from the pristine synth.
    ///
    /// Error recovery marks expressions that do not compile. `typst_ide`
    /// resolves field access by tracing values, and tracing compiles
    /// `world.main`, so IDE queries need a compilable main. Marked ranges are
    /// replaced with equal-length valid expressions there, which keeps byte
    /// positions (and therefore every source-map offset) unchanged. IDE
    /// queries inside a marked range parse the pristine file instead, so the
    /// token under the cursor is still the user's.
    pub fn rebuild_ide_source(&self, world: &mut TypstWorld) {
        let Some(pristine) = self
            .synth_source(world)
            .map(|source| source.text().to_string())
        else {
            return;
        };

        let patched = self.patch_marked_ranges(&pristine);

        world.insert_source(self.ide_id, patched);
    }

    fn patch_marked_ranges(&self, pristine: &str) -> String {
        let ranges = self.patched_synth_ranges();

        if ranges.is_empty() {
            return pristine.to_string();
        }

        let mut patched = pristine.to_string();

        // Equal-length replacements, so applying them in any order keeps the
        // remaining offsets valid.
        for range in ranges.into_iter().rev() {
            let start = range.start.min(patched.len());
            let end = range.end.min(patched.len()).max(start);
            let length = end - start;

            if length == 0 {
                continue;
            }

            let replacement = if length == 1 {
                String::from("0")
            } else {
                let mut text = String::with_capacity(length);
                text.push('"');
                text.push_str(&" ".repeat(length - 2));
                text.push('"');
                text
            };

            patched.replace_range(start..end, &replacement);
        }

        patched
    }

    /// Marked raw ranges mapped into pristine-synth coordinates, merged and
    /// sorted. Marked ranges can nest across recovery passes.
    fn patched_synth_ranges(&self) -> Vec<Range<usize>> {
        if self.marked_raw_ranges.is_empty() {
            return Vec::new();
        }

        let mut ranges = self
            .marked_raw_ranges
            .iter()
            .map(|raw| {
                self.index_map.forward(raw.start, Side::After)
                    ..self.index_map.forward(raw.end, Side::Before)
            })
            .collect::<Vec<_>>();

        ranges.sort_by_key(|range| range.start);

        let mut merged: Vec<Range<usize>> = Vec::new();
        for range in ranges {
            if let Some(last) = merged.last_mut()
                && range.start <= last.end
            {
                last.end = last.end.max(range.end);
            } else {
                merged.push(range);
            }
        }

        merged
    }

    /// Whether a span belongs to one of this note's compile sources. Spans
    /// from the render source show up in diagnostics and frame items after
    /// recovery; spans from the pristine synth show up in IDE queries.
    #[must_use]
    pub fn owns_span(&self, id: FileId) -> bool {
        id == self.synth_id || id == self.render_id
    }

    /// Raw offset to pristine-synth offset.
    ///
    /// Use [`Side::After`] for cursors and span starts, [`Side::Before`] for
    /// span ends. Positions in dropped source regions clamp to the nearest
    /// segment boundary.
    #[must_use]
    pub fn map_raw_to_synth(&self, raw: usize, side: Side) -> usize {
        self.index_map.forward(raw, side)
    }

    /// Pristine-synth offset to raw offset.
    #[must_use]
    pub fn map_synth_to_raw(&self, synth: usize) -> usize {
        self.index_map.backward(synth)
    }

    /// Raw offset to repaired offset.
    #[must_use]
    pub fn map_raw_to_repaired(&self, raw: usize, side: Side) -> usize {
        self.render_fixups.map().forward(raw, side)
    }

    /// Repaired offset to raw offset.
    #[must_use]
    pub fn map_repaired_to_raw(&self, repaired: usize) -> usize {
        self.render_fixups.map().backward(repaired)
    }

    /// Repaired offset to render offset. Recovery internals work in these two
    /// spaces directly; blocks and equation ranges come from the repaired
    /// parse.
    #[must_use]
    pub fn map_repaired_to_render(&self, repaired: usize, side: Side) -> usize {
        self.render_map.forward(repaired, side)
    }

    /// Render offset to repaired offset.
    #[must_use]
    pub fn map_render_to_repaired(&self, render: usize) -> usize {
        self.render_map.backward(render)
    }

    /// Raw offset to render offset, through the repaired text.
    #[must_use]
    pub fn map_raw_to_render(&self, raw: usize, side: Side) -> usize {
        let repaired = self.render_fixups.map().forward(raw, side);
        self.render_map.forward(repaired, side)
    }

    /// Render offset to raw offset, through the repaired text. Use this for
    /// anything the editor consumes: diagnostics, chunk ranges, jumps.
    #[must_use]
    pub fn map_render_to_raw(&self, render: usize) -> usize {
        let repaired = self.render_map.backward(render);
        self.render_fixups.map().backward(repaired)
    }
}
