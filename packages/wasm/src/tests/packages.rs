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
    append(&mut builder, "lib.typ", "#let answer = 42\n");

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
