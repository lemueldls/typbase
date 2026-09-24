//! Package installs: a Universe tarball unpacks under its package root in the
//! virtual filesystem, imports resolve against it, and removal takes it back
//! out.

use flate2::{Compression, write::GzEncoder};
use tar::{Builder, EntryType, Header};
use typst_syntax::VirtualRoot;

use crate::tests::harness;

const SPEC: &str = "@preview/mylib:0.1.0";

/// A minimal Universe package. Real tarballs carry a leading `.` directory
/// entry and file paths relative to the package root.
fn package_tarball() -> Vec<u8> {
    package_tarball_with("#let answer = 42\n")
}

/// [`package_tarball`] with a custom `lib.typ`, for tests that need a package
/// function which fails in a specific way.
fn package_tarball_with(lib: &str) -> Vec<u8> {
    let mut builder = Builder::new(GzEncoder::new(Vec::new(), Compression::default()));

    let mut header = Header::new_gnu();
    header.set_entry_type(EntryType::Directory);
    header.set_size(0);
    header.set_mode(0o755);
    header.set_cksum();
    builder.append_data(&mut header, ".", &[][..]).unwrap();

    append(
        &mut builder,
        "typst.toml",
        "[package]\nname = \"mylib\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
    );
    append(&mut builder, "lib.typ", lib);

    builder.into_inner().unwrap().finish().unwrap()
}

fn append(builder: &mut Builder<GzEncoder<Vec<u8>>>, path: &str, text: &str) {
    let mut header = Header::new_gnu();
    header.set_size(text.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, path, text.as_bytes())
        .unwrap();
}

fn package_files(state: &crate::state::TypstState) -> usize {
    state
        .world
        .files
        .keys()
        .filter(|id| matches!(id.root(), VirtualRoot::Package(_)))
        .count()
}

#[test]
fn installed_package_files_are_removed() {
    let mut state = harness::state();
    assert_eq!(package_files(&state), 0);

    state.install_package(SPEC, package_tarball()).unwrap();
    assert_eq!(package_files(&state), 2);

    state.remove_package(SPEC).unwrap();
    assert_eq!(package_files(&state), 0);
}

/// A document that imports a package compiles once the package is installed.
#[test]
fn package_import_compiles_after_install() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    state.install_package(SPEC, package_tarball()).unwrap();

    let id = harness::page(&mut state, "package_import");
    let source = "#import \"@preview/mylib:0.1.0\": answer\n\nThe answer is #answer.\n";
    let render = harness::compile(&mut state, &id, source);

    assert!(render.document.is_some(), "{:#?}", render.diagnostics);
    assert!(render.diagnostics.is_empty(), "{:#?}", render.diagnostics);
}

/// A missing package is recorded as a request for the host to answer instead
/// of panicking the compile.
#[test]
fn missing_package_is_requested() {
    let mut state = harness::state();
    let id = harness::page(&mut state, "package_request");
    let source = "#import \"@preview/absent:0.1.0\": x\n";

    let _ = harness::compile(&mut state, &id, source);

    assert!(
        state
            .world
            .requested_packages
            .iter()
            .any(|spec| spec.name.as_str() == "absent"),
        "missing package was not recorded as a request",
    );
}

/// `lib.typ` whose `explode` panics after `context` deferral: the shape that
/// loses the eval trace. Diagraph's plugin call inside `layout` is the real
/// case.
const CONTEXT_PANIC_LIB: &str = "#let explode() = layout(size => context { panic(\"boom\") })\n";

fn state_with_context_panic() -> crate::state::TypstState {
    let mut state = harness::state();
    state
        .install_package(SPEC, package_tarball_with(CONTEXT_PANIC_LIB))
        .unwrap();

    state
}

/// A package error raised after `context` deferral reports a span and trace
/// that all sit in the package, so no diagnostic maps to a block. Recovery
/// must bisect the blocks, blank the calling block, and render the rest.
#[test]
fn package_context_error_recovers() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = state_with_context_panic();
    let id = harness::page(&mut state, "package_context_error");
    let source = "#import \"@preview/mylib:0.1.0\": explode\n\nBefore.\n\n#explode()\n\nAfter.\n";
    let render = harness::compile(&mut state, &id, source);

    assert!(render.document.is_some(), "{:#?}", render.diagnostics);

    let boom = render
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.message.contains("boom"))
        .expect("no panic diagnostic after recovery");

    // The error lands on the call, not on the whole note.
    let start = source.find("#explode()").unwrap();
    assert_eq!(
        boom.range,
        start..start + "#explode()".len(),
        "{:#?}",
        render.diagnostics
    );
}

/// Two unmappable blocks each get their own range: the blamed prefix's errors
/// are reported per block, not lumped onto the first one.
#[test]
fn two_unmappable_blocks_get_their_own_ranges() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = state_with_context_panic();
    let id = harness::page(&mut state, "two_package_context_errors");
    let source = "#import \"@preview/mylib:0.1.0\": explode\n\nBefore.\n\n#explode()\n\nMiddle.\n\n#explode()\n\nAfter.\n";
    let render = harness::compile(&mut state, &id, source);

    assert!(render.document.is_some(), "{:#?}", render.diagnostics);

    let first = source.find("#explode()").unwrap();
    let second = source[first + 1..].find("#explode()").unwrap() + first + 1;
    let length = "#explode()".len();

    let ranges = render
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.message.contains("boom"))
        .map(|diagnostic| diagnostic.range.clone())
        .collect::<Vec<_>>();

    assert_eq!(
        ranges,
        vec![first..first + length, second..second + length],
        "{:#?}",
        render.diagnostics
    );
}

/// A block with more than one call keeps the block range: narrowing to a
/// guessed call would point at the wrong line.
#[test]
fn multi_call_block_keeps_block_range() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = state_with_context_panic();
    let id = harness::page(&mut state, "multi_call_context_error");
    let source = "#import \"@preview/mylib:0.1.0\": explode\n\nBefore.\n\n#text(\"x\") #explode()\n\nAfter.\n";
    let render = harness::compile(&mut state, &id, source);

    assert!(render.document.is_some(), "{:#?}", render.diagnostics);

    let boom = render
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.message.contains("boom"))
        .expect("no panic diagnostic after recovery");

    let start = source.find("#text").unwrap();
    assert_eq!(
        boom.range,
        start..start + "#text(\"x\") #explode()".len(),
        "{:#?}",
        render.diagnostics
    );
}

/// The HTML frames renderer (plugin surfaces) recovers the same way and gets
/// the same blamed range.
///
/// `layout` does not run its callback in the HTML target, so the package
/// errors through `locate` instead: same missing trace, different entry.
#[test]
fn package_context_error_recovers_html() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    state
        .install_package(
            SPEC,
            package_tarball_with("#let explode() = context { locate(loc => panic(\"boom\")) }\n"),
        )
        .unwrap();

    let id = harness::page(&mut state, "package_context_error_html");
    let source = "#import \"@preview/mylib:0.1.0\": explode\n\nBefore.\n\n#explode()\n\nAfter.\n";
    let result = crate::renderer::html::render(&id, source, "", &mut state);

    assert_eq!(result.frames.len(), 1, "{:#?}", result.diagnostics);

    let start = source.find("#explode()").unwrap();
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.range == (start..start + "#explode()".len())),
        "expected a diagnostic on the call block, got {:#?}",
        result.diagnostics
    );
}

/// The full-document HTML render (publish, export, chat) recovers the same
/// way.
#[test]
fn package_context_error_recovers_html_document() {
    if !harness::fonts_available() {
        eprintln!("skipping: bundled fonts missing");
        return;
    }

    let mut state = harness::state();
    state
        .install_package(
            SPEC,
            package_tarball_with("#let explode() = context { locate(loc => panic(\"boom\")) }\n"),
        )
        .unwrap();

    let id = harness::page(&mut state, "package_context_error_html_document");
    let source = "#import \"@preview/mylib:0.1.0\": explode\n\nBefore.\n\n#explode()\n\nAfter.\n";
    let synth = crate::source::sync_source_state(
        &id,
        source,
        "",
        crate::source::RenderTarget::Html,
        &mut state,
    );
    let mut ctx = state.render_context(&id).unwrap();
    let (document, diagnostics) =
        crate::renderer::html::document::render_html_ctx(&mut ctx, &synth.blocks);

    assert!(document.is_some(), "{diagnostics:#?}");

    let start = source.find("#explode()").unwrap();
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.range == (start..start + "#explode()".len())),
        "expected a diagnostic on the call block, got {diagnostics:#?}"
    );
}
