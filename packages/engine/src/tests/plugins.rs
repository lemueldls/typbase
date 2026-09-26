//! The plugin surface contract: the host-generated wrapper, `ui.typ`, and the
//! bundled plugins compile to HTML with a patch holder the host can read.

use crate::{
    bindings::TypstDiagnosticSeverity,
    renderer::html::render,
    tests::harness,
};

const UI_LIB: &str = include_str!("../../../../apps/web/public/plugins/ui.typ");
const CALENDAR: &str = include_str!("../../../../apps/web/public/plugins/calendar/main.typ");
const DRAWING: &str = include_str!("../../../../apps/web/public/plugins/drawing/main.typ");

/// Placeholder JSON replaced per test; both fields are spliced raw.
const BASE_CTX: &str = r##"{
  "plugin": { "id": "local:demo", "name": "Demo", "version": "0.1.0" },
  "instance": { "id": "inst-1", "title": "Demo" },
  "surface": { "kind": "pane", "title": "Demo" },
  "locale": "en",
  "now": "2026-09-26T12:00:00.000Z",
  "today": "2026-09-26",
  "config": {},
  "state": __STATE__,
  "view": {},
  "action": __ACTION__,
  "result": null,
  "page": __PAGE__,
  "data": null,
  "theme": {
    "text": "#1f2328",
    "textSecondary": "#6b7280",
    "accent": "#1e5aa0",
    "accentSoft": "#e3edf8",
    "red": "#b42828",
    "yellow": "#99660f",
    "green": "#2f6f4f",
    "blue": "#1e5aa0",
    "violet": "#7a3fa0",
    "surface": "#ffffff"
  }
}"##;

fn ctx(state: &str, action: &str, page: &str, surface: &str) -> String {
    BASE_CTX
        .replace("__STATE__", state)
        .replace("__ACTION__", action)
        .replace("__PAGE__", page)
        .replace(r#""surface": { "kind": "pane", "title": "Demo" }"#, surface)
}

/// Mirrors the wrapper `apps/web/src/lib/plugins/compile.ts` generates.
fn wrapper_source(entry: &str, function: &str) -> String {
    format!(
        "#import \"/typbase/plugin/demo/{entry}\": {function}\n\
         #let ctx = json(\"/typbase/plugin/ctx.json\")\n\
         #let page = {function}(ctx)\n\
         #let ui = page.at(\"ui\")\n\
         #let patch = (state: page.at(\"state\", default: ()), view: page.at(\"view\", default: ()))\n\
         #html.elem(\"div\", attrs: (\"hidden\": \"hidden\", \"data-tb-patch\": json.encode(patch)))\n\
         #html.elem(\"div\", attrs: (class: \"tb-surface\"), ui)\n"
    )
}

fn compile_surface(
    entry: &str,
    function: &str,
    source: &str,
    ctx: &str,
    files: &[(&str, &str)],
) -> (String, Vec<String>) {
    let mut state = harness::state();

    let ui_id = state.create_file_id("/typbase/ui.typ");
    state.insert_source(&ui_id, UI_LIB.to_string());

    let plugin_id = state.create_file_id(&format!("/typbase/plugin/demo/{entry}"));
    state.insert_source(&plugin_id, source.to_string());

    // The host resolves query requests before the final compile; the test
    // provides the same JSON up front.
    for (path, text) in files {
        let id = state.create_file_id(path);
        state.insert_file(&id, text.as_bytes().to_vec());
    }

    let ctx_id = state.create_file_id("/typbase/plugin/ctx.json");
    state.insert_file(&ctx_id, ctx.as_bytes().to_vec());

    let wrapper = wrapper_source(entry, function);
    let id = state.create_source_id("/typbase/surface", String::from("plugin-host"));
    state.insert_source(&id, wrapper.clone());

    let result = render(&id, &wrapper, "", &mut state);
    let html = result
        .frames
        .first()
        .map(|frame| frame.render.html.clone())
        .unwrap_or_default();
    let errors = result
        .diagnostics
        .iter()
        .filter(|diagnostic| matches!(diagnostic.severity, TypstDiagnosticSeverity::Error))
        .map(|diagnostic| diagnostic.message.clone())
        .collect();

    (html, errors)
}

#[test]
fn calendar_surface_compiles_and_emits_a_patch() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let ctx = ctx(
        r#"{ "events": [{ "id": "e1", "title": "Dentist", "date": "2026-09-26", "time": "10:00" }] }"#,
        r#"{ "id": "a1", "name": "event.create", "args": { "date": "2026-09-26" }, "fields": { "title": "Checkup", "date": "2026-09-26", "time": "09:00" } }"#,
        "null",
        r#""surface": { "kind": "pane", "title": "Demo" }"#,
    );

    let (html, errors) = compile_surface(
        "main.typ",
        "pane",
        CALENDAR,
        &ctx,
        &[
            ("typbase/query/daily/2026-09.json", "[]"),
            ("typbase/query/content/2026-09-26.json", "null"),
        ],
    );

    assert!(errors.is_empty(), "calendar pane errors: {errors:?}");
    assert!(html.contains("data-tb-patch"), "no patch holder in: {html}");
    assert!(html.contains("class=\"tb-surface\""), "no surface container in: {html}");
    assert!(html.contains("Dentist"), "existing event missing from: {html}");
    assert!(html.contains("cal-day--selected"), "selected day has no tone: {html}");
    assert!(html.contains("event.create"), "create action missing from: {html}");
    // The action render carries the appended record in its patch; the UI
    // itself stays pre-patch until the host rerenders.
    assert!(
        html.contains("&quot;op&quot;: &quot;append&quot;"),
        "append op missing from: {html}"
    );
    assert!(html.contains("Checkup"), "append record missing from: {html}");
}

#[test]
fn unresolved_requests_render_recovery_instead_of_panicking() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    // The host answers `#typbase.query` after the first compile; that pass
    // sees missing-file diagnostics and must not panic on them.
    let ctx = ctx(
        "{}",
        "null",
        "null",
        r#""surface": { "kind": "pane", "title": "Demo" }"#,
    );

    let (html, errors) = compile_surface("main.typ", "pane", CALENDAR, &ctx, &[]);

    assert!(errors.iter().any(|error| error.contains("failed to load file")));
    assert!(!html.is_empty(), "recovery should still produce a frame");
}

#[test]
fn drawing_surface_compiles_with_theme_colors_and_a_chain() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");

        return;
    }

    let ctx = ctx(
        "{}",
        "null",
        r#"{ "id": "page-1" }"#,
        r#""surface": { "kind": "window", "title": "Drawing" }"#,
    );

    let (html, errors) = compile_surface("main.typ", "window", DRAWING, &ctx, &[]);

    assert!(errors.is_empty(), "drawing window errors: {errors:?}");
    assert!(html.contains("--tb-swatch:#b42828"), "theme swatch missing from: {html}");
    assert!(html.contains("data-tb-chain"), "insert chain missing from: {html}");
    assert!(html.contains("data-tb-component"), "canvas component missing from: {html}");
}
