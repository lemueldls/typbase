//! The document prelude: the app's Typst stdlib module and the style block
//! every compile prepends.
//!
//! `TYPBASE_LIB` is inserted into the world once at construction and imported
//! by the generated prelude as `typbase`. `style_prelude` builds the canonical
//! document style (theme, body text, headings, links, strokes, math and raw
//! fonts, code-block theme); the same text is exposed to JS through
//! `stylePrelude` so exports and the project mirror cannot drift from the
//! engine.

use indoc::formatdoc;
use wasm_bindgen::prelude::*;

use crate::{bindings::TypstFileId, source::RenderTarget, state::TypstState, theme::ThemeColors};

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
pub const TYPBASE_LIB: &str = r#"
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

// A semantic block for app-side consumers (AI context, plugins).
// The body renders where it sits; the app reads kind and range off the AST.
#let section(kind: none, body) = body
"#;

// The import and the request paths are root-absolute: pages compile from
// `pages/<id>.typ`, so a relative import would resolve next to the page
// instead of at the workspace root.
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

            #show raw:set text(font:"{code_font}")
            #show raw:set raw(theme:"/{syntax_theme}")
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
