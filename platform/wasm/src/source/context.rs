use typst_html::HtmlDocument;
use typst_layout::PagedDocument;
use typst_syntax::{FileId, RootedPath, Source};

use crate::{
    source::{IndexMapper, RawFixups},
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
///   raw text on every sync. Never mutated after that; [`Self::index_mapper`]
///   describes it and diagnostics-only compiles read it.
/// - **render**: the disposable source the renderer compiles, `render_id`.
///   Built from the repaired text; error recovery marks and blanks ranges of
///   it and updates [`Self::render_mapper`] instead of touching the pristine
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

    /// Which space this note belongs to. Used to look up the associated
    /// [`SpaceContext`] for theme and font settings.
    pub space_id: String,

    /// Tracks the byte-offset correspondence between the raw source
    /// and the pristine synth. Rebuilt on each call to `sync_source_context`.
    pub index_mapper: IndexMapper,

    /// Byte-offset correspondence between the repaired source and the render
    /// source. Cloned from [`Self::index_mapper`] when no repair was needed;
    /// error recovery adds anchors for the ranges it rewrites.
    pub render_mapper: IndexMapper,

    /// Delimiter insertions applied between raw and repaired text. Empty for
    /// the vast majority of notes.
    pub render_fixups: RawFixups,

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
            synth_id.vpath().with_extension("$.typ"),
        ));
        let render_id = FileId::new(RootedPath::new(
            synth_id.root().clone(),
            synth_id.vpath().with_extension("render.typ"),
        ));

        Self {
            synth_id,
            raw_id,
            render_id,
            space_id,
            index_mapper: IndexMapper::default(),
            render_mapper: IndexMapper::default(),
            render_fixups: RawFixups::default(),
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

    /// Whether a span belongs to one of this note's compile sources. Spans
    /// from the render source show up in diagnostics and frame items after
    /// recovery; spans from the pristine synth show up in IDE queries.
    #[must_use]
    pub fn owns_span(&self, id: FileId) -> bool {
        id == self.synth_id || id == self.render_id
    }

    #[must_use]
    pub fn map_synth_to_raw_from_right(&self, synth_idx: usize) -> usize {
        self.index_mapper.map_synth_to_raw_from_right(synth_idx)
    }

    #[must_use]
    pub fn map_raw_to_synth_from_right(&self, raw_idx: usize) -> usize {
        self.index_mapper.map_raw_to_synth_from_right(raw_idx)
    }

    #[must_use]
    pub fn map_synth_to_raw_from_left(&self, synth_idx: usize) -> usize {
        self.index_mapper.map_synth_to_raw_from_left(synth_idx)
    }

    #[must_use]
    pub fn map_raw_to_synth_from_left(&self, raw_idx: usize) -> usize {
        self.index_mapper.map_raw_to_synth_from_left(raw_idx)
    }

    /// Render offset to raw offset, through the repaired text. Use this for
    /// anything the editor consumes: diagnostics, chunk ranges, jumps.
    #[must_use]
    pub fn map_render_to_raw_from_right(&self, render_idx: usize) -> usize {
        let repaired = self.render_mapper.map_synth_to_raw_from_right(render_idx);
        self.render_fixups.to_raw_from_right(repaired)
    }

    #[must_use]
    pub fn map_render_to_raw_from_left(&self, render_idx: usize) -> usize {
        let repaired = self.render_mapper.map_synth_to_raw_from_left(render_idx);
        self.render_fixups.to_raw_from_left(repaired)
    }

    /// Raw offset to render offset, through the repaired text.
    #[must_use]
    pub fn map_raw_to_render_from_right(&self, raw_idx: usize) -> usize {
        let repaired = self.render_fixups.to_repaired_from_right(raw_idx);
        self.render_mapper.map_raw_to_synth_from_right(repaired)
    }

    #[must_use]
    pub fn map_raw_to_render_from_left(&self, raw_idx: usize) -> usize {
        let repaired = self.render_fixups.to_repaired_from_left(raw_idx);
        self.render_mapper.map_raw_to_synth_from_left(repaired)
    }

    /// Repaired offset to render offset. Recovery internals work in these two
    /// spaces directly; blocks and equation ranges come from the repaired
    /// parse.
    #[must_use]
    pub fn map_repaired_to_render_from_left(&self, repaired_idx: usize) -> usize {
        self.render_mapper.map_raw_to_synth_from_left(repaired_idx)
    }

    #[must_use]
    pub fn map_repaired_to_render_from_right(&self, repaired_idx: usize) -> usize {
        self.render_mapper.map_raw_to_synth_from_right(repaired_idx)
    }

    /// Render offset to repaired offset.
    #[must_use]
    pub fn map_render_to_repaired_from_left(&self, render_idx: usize) -> usize {
        self.render_mapper.map_synth_to_raw_from_left(render_idx)
    }

    #[must_use]
    pub fn map_render_to_repaired_from_right(&self, render_idx: usize) -> usize {
        self.render_mapper.map_synth_to_raw_from_right(render_idx)
    }

    /// Repaired offset to raw offset, through the delimiter fixups only.
    #[must_use]
    pub fn map_repaired_to_raw_from_left(&self, repaired_idx: usize) -> usize {
        self.render_fixups.to_raw_from_left(repaired_idx)
    }

    #[must_use]
    pub fn map_repaired_to_raw_from_right(&self, repaired_idx: usize) -> usize {
        self.render_fixups.to_raw_from_right(repaired_idx)
    }
}
