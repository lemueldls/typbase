//! The document prelude: the app's Typst stdlib module and the style block
//! every compile prepends.
//!
//! `TYPBASE_LIB` is inserted into the world once at construction and imported
//! by the generated prelude as `typbase`; it carries `query`, `page-link`,
//! `embed`, and `section`. The prelude also binds `theme`, `note`,
//! and the host values under `sys.inputs`. `style_prelude` builds the canonical
//! document style (theme, body text, headings, links, strokes, math and raw
//! fonts, code-block theme); the same text is exposed to JS through
//! `stylePrelude` so exports and the project mirror cannot drift from the
//! engine.

use indoc::formatdoc;
use wasm_bindgen::prelude::*;

use crate::{bindings::TypstFileId, source::RenderTarget, state::TypstState, theme::ThemeColors};

// The stdlib module, inserted into the world once at TypstState::new and
// imported by the generated prelude as `typbase`. Its functions are documented
// inside the Typst source: that text is what note authors and models write
// against, and `typbaseLib()` ships it to the AI dialect card and to exported
// projects unchanged.
//
// `query` loads JSON the JS side synthesizes on demand (file request
// `/typbase/query/<kind>.json`); `embed` includes another page's source
// (source request `/typbase/src/<id>.typ`). Filters ride in the path because
// the request channel only carries paths, so keep filter values slug-safe.
//
// The prelude around this module defines `theme` (the resolved palette),
// `note` (the compiling page's own data), and the host values under
// `sys.inputs` (`page`, `workspace`, `reason`). An included file sees none of
// them: Typst evaluates `include` as its own module, so an embedded page that
// uses `theme` or `note` fails unless it defines them itself.
//
// Paths are root-absolute so the same source compiles both in the wasm world
// and in a plain Typst project rooted at the workspace (see `typbase/`).
//
// It is a module rather than a dict of closures: Typst cannot call dict
// values with dot syntax (`typbase.query(...)`), but module functions can.
pub const TYPBASE_LIB: &str = r#"
// Typbase's document stdlib. Every compile imports it as `typbase`, and an
// exported project ships the same source as `typbase/lib.typ`.

// Workspace data as decoded JSON. `kind` is one of:
//   "config"      -> { name, homePageId, font }
//   "pages"       -> all pages; filter "by-id/<page-id>" or "by-category/<id>"
//   "categories"  -> [{ id, name }]
//   "daily"       -> all daily notes; filter "by-month/<YYYY-MM>"
//   "backlinks"   -> pages that link the page id in the filter
//   "sections"    -> one page's sections with "sections/<page-id>", or every
//                    page's without a filter
//   "content"     -> { id, title, path, text } for a page id or daily date
//   "plugin-data" -> one plugin instance's stored collections
// The app synthesizes the JSON from the workspace while it compiles.
#let query(kind, filter: none) = {
  let target = if filter == none {
    "/typbase/query/" + kind + ".json"
  } else {
    "/typbase/query/" + kind + "/" + str(filter) + ".json"
  }
  json(target)
}

// A link to another page: the page's title, or `body` when given. A missing
// page and a `none` target render the word "none" instead of failing the
// compile, so `#typbase.page-link(note.next)` works when there is no next
// day. The app turns `typbase://page/<id>` clicks into page opens.
#let page-link(page-id, body: none) = {
  let id = if page-id == none { "none" } else { str(page-id) }
  let meta = json("/typbase/query/pages/by-id/" + id + ".json")
  if meta == none {
    if body == none [none] else [#body]
  } else {
    let url = "typbase://page/" + id
    if body == none [#link(url)[#meta.title]] else [#link(url)[#body]]
  }
}

// Includes another page's raw source in place; `none` includes nothing.
// Unlike `page-link`, the other page compiles as part of this one. It is
// evaluated as its own module, so it can call `typbase` but not the host
// page's `note`, `theme`, or `sys.inputs`.
#let embed(id) = if id == none { [] } else { include("/typbase/src/" + str(id) + ".typ") }

// A named block for app-side consumers: the kind and source range land in the
// page's section list, which the AI context and plugins read. The body renders
// where it sits.
#let section(kind: none, body) = body
"#;

// The import and the request paths are root-absolute: pages compile from their
// workspace path (`daily/2026-09-27.typ`), so a relative import would resolve
// next to the page instead of at the workspace root.
const TYPBASE_PRELUDE: &str = r#"
    #import "/typbase/lib.typ" as typbase
"#;

/// The canonical document style: theme, body text, headings, links, shape
/// strokes, math and raw fonts, and the code-block theme. Live compiles append
/// the render-target page config in [`TypstState::prelude`]; exports and the
/// project mirror call it through the `stylePrelude` binding, so the app and
/// the files it writes cannot drift.
fn style_prelude(
    theme: &ThemeColors,
    text_size: f64,
    font: &str,
    math_font: &str,
    code_font: &str,
    locale: &str,
) -> String {
    let h1 = text_size * 2.0;
    let h2 = text_size * 1.75;
    let h3 = text_size * 1.5;
    let h4 = text_size * 1.375;
    let h5 = text_size;
    let h6 = text_size * 0.875;
    let block_math = text_size * 1.125;

    formatdoc!(
        r#"
            #let theme={theme}

            #set text(fill:theme.text,size:{text_size}pt,lang:"{locale}",font:"{font}")

            #show heading.where(level:1):set text(fill:theme.accent,size:{h1}pt,weight:400)
            #show heading.where(level:2):set text(fill:theme.text,size:{h2}pt,weight:400)
            #show heading.where(level:3):set text(fill:theme.text-secondary,size:{h3}pt,weight:400)
            #show heading.where(level:4):set text(fill:theme.accent,size:{h4}pt,weight:400)
            #show heading.where(level:5):set text(fill:theme.text,size:{h5}pt,weight:500)
            #show heading.where(level:6):set text(fill:theme.text-secondary,size:{h6}pt,weight:500)

            #show link:set text(fill:theme.accent)
            #show link:underline

            #set line(stroke:theme.border)
            #set table(stroke:theme.border)
            #set circle(stroke:theme.border)
            #set ellipse(stroke:theme.border)
            #set curve(stroke:theme.border)
            #set polygon(stroke:theme.border)
            #set rect(stroke:theme.border)
            #set square(stroke:theme.border)

            #show math.equation:set text(font:"{math_font}")
            #show math.equation.where(block:true):set text(size:{block_math}pt)
            #show math.equation.where(block:true):set par(leading:0.5em)

            #set raw(lang:"typst",theme:"/{syntax_theme}")
            #show raw:set text(font:"{code_font}")
            #show raw.where(block:true):it=>block(fill:theme.code,inset:8pt,radius:4pt,width:100%,it)

            #context {{show math.equation:set text(size:text.size*2)}}

            {typbase_prelude}
        "#,
        typbase_prelude = TYPBASE_PRELUDE,
        syntax_theme = theme.syntax_theme_path(),
    )
}

#[comemo::track]
impl TypstState {
    /// The complete prelude for one note and render target: the canonical
    /// style block plus the render-target page config.
    pub fn prelude(&self, id: &TypstFileId, render_target: RenderTarget) -> String {
        let source_ctx = self.source_context_map.get(id).unwrap();
        let space_ctx = self.space_context_map.get(&source_ctx.space_id).unwrap();

        let page_config = match render_target {
            RenderTarget::Svg => {
                formatdoc!(
                    r#"
                        #set page(fill:rgb(0,0,0,0),width:{width},height:auto,margin:0pt)
                        #set text(top-edge:"ascender",bottom-edge:"descender")
                        #set par(leading:0.08em)
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

        let style = style_prelude(
            &space_ctx.theme,
            space_ctx.text_size,
            &space_ctx.font,
            space_ctx.math_font.as_ref().unwrap_or(&space_ctx.font),
            space_ctx.code_font.as_ref().unwrap_or(&space_ctx.font),
            &space_ctx.locale,
        );

        formatdoc!(
            r#"
                {style}

                {page_config}
            "#,
        )
    }
}

#[wasm_bindgen]
impl TypstState {
    /// The stdlib source as shipped, for writing a compilable project to disk.
    #[wasm_bindgen(js_name = "typbaseLib")]
    #[must_use]
    pub fn typbase_lib(&self) -> String {
        TYPBASE_LIB.to_string()
    }

    /// The style block alone, for exports and the project mirror: the same
    /// text the engine prepends, minus the render-target page config.
    #[must_use]
    #[wasm_bindgen(js_name = "stylePrelude")]
    pub fn style_prelude_export(
        theme: ThemeColors,
        text_size: f64,
        font: String,
        math_font: Option<String>,
        code_font: Option<String>,
        locale: String,
    ) -> String {
        style_prelude(
            &theme,
            text_size,
            &font,
            math_font.as_deref().unwrap_or(&font),
            code_font.as_deref().unwrap_or(&font),
            &locale,
        )
    }
}
