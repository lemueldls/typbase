//! Criterion benches for the engine hot paths.
//!
//! Run with `moon run engine:bench` (or `cargo bench --bench engine`). Compile
//! benches need the bundled fonts. They skip with a printed note when the
//! font files are missing. Numbers are only comparable on the same machine
//! and profile.

use std::{hint::black_box, path::Path};

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use engine::{
    bindings::TypstFileId,
    flatten::{extract_cells, flatten_document},
    links::extract_links,
    renderer::{html, paged::items::chunk_by_items},
    source::{RenderTarget, Side, find_fixes, sync_source_state},
    state::TypstState,
};
use flate2::{Compression, write::GzEncoder};
use tar::{Builder, EntryType, Header};
use typst_syntax::parse as parse_typst;

const FONTS: &[&str] = &[
    "maple/MapleMono-Regular.ttf",
    "maple/MapleMono-Bold.ttf",
    "maple/MapleMono-Italic.ttf",
    "math/NewCMMath-Regular.otf",
];

const PLAIN: &str =
    "Hello, *world*.\n\nA second paragraph with `code` and a\nline break inside it.\n";

const STRUCTURE: &str = "\
#set par(justify: true)
= Title

Body after the heading.

- one
- two
  - nested

| a | b |
|---|---|
| 1 | 2 |

// a comment
#let x = 1
Paragraph with #x and a #link(\"https://typbase.at\")[link].
";

const MATH: &str = "\
Inline $x^2 + y^2 = z^2$ stays inline.

$ integral_0^1 x dif x = 1/2 $
";

const BROKEN: &str = "\
Before.

$ notdefined + integral.triple dif x $

$ x + y

After.
";

fn fonts_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/fonts")
}

fn fonts_available() -> bool {
    FONTS.iter().all(|rel| fonts_dir().join(rel).is_file())
}

fn state() -> TypstState {
    let mut state = TypstState::new();

    for rel in FONTS {
        if let Ok(bytes) = std::fs::read(fonts_dir().join(rel)) {
            state.install_font(bytes);
        }
    }

    state
}

fn page(state: &mut TypstState, name: &str) -> TypstFileId {
    state.create_source_id(&format!("pages/{name}.typ"), String::from("bench"))
}

/// A long document: paragraph wrapping, inline math, and blank lines.
fn large_document(paragraphs: usize) -> String {
    let mut text = String::with_capacity(paragraphs * 72);

    for index in 0..paragraphs {
        text.push_str(&format!(
            "Paragraph {index} with *markup*, `code`, and $x_{index} + y$.\n\n"
        ));
    }

    text
}

/// A notebook of `cells` cells, alternating prose and code.
fn large_notebook(cells: usize) -> String {
    let mut text = String::with_capacity(cells * 80);

    for index in 0..cells {
        if index % 2 == 0 {
            text.push_str(&format!(
                "//% kind=code\n#let value_{index} = {index}\n#value_{index}\n\n"
            ));
        } else {
            text.push_str(&format!(
                "Paragraph {index} with $x_{index} + y$ and some *markup*.\n\n"
            ));
        }
    }

    text
}

/// Varies one character so each iteration is a real build.
fn varying(base: &str) -> impl FnMut() -> String {
    let mut tick = 0usize;
    move || {
        tick += 1;
        format!("{base}\nkeystroke {tick}\n")
    }
}

fn bench_synth(c: &mut Criterion) {
    let cases = [
        ("plain", PLAIN.to_string()),
        ("structure", STRUCTURE.to_string()),
        ("math", MATH.to_string()),
        ("large", large_document(300)),
    ];

    let mut group = c.benchmark_group("synth");
    group.sample_size(20);

    for (name, text) in &cases {
        let mut state = TypstState::new();
        let id = page(&mut state, name);
        let mut next = varying(text);

        group.bench_function(BenchmarkId::from_parameter(name), |b| {
            b.iter(|| {
                let text = next();
                let result =
                    sync_source_state(&id, black_box(&text), "", RenderTarget::Svg, &mut state);
                black_box(result.blocks.len());
            });
        });
    }

    group.finish();
}

fn bench_source_map(c: &mut Criterion) {
    let text = large_document(300);
    let mut state = TypstState::new();
    let id = page(&mut state, "map");
    let _ = sync_source_state(&id, &text, "", RenderTarget::Svg, &mut state);

    let map = state.source_map(&id).unwrap().clone();
    let len = map.from_len();

    let mut group = c.benchmark_group("source_map");
    group.sample_size(20);

    group.bench_function("forward", |b| {
        b.iter(|| {
            for offset in 0..=len {
                black_box(map.forward(offset, Side::After));
            }
        });
    });

    group.bench_function("backward", |b| {
        b.iter(|| {
            for offset in 0..=len {
                black_box(map.backward(offset));
            }
        });
    });

    group.finish();
}

fn bench_delimiters(c: &mut Criterion) {
    let cases = [
        ("clean", large_document(50)),
        (
            "unclosed",
            String::from("Before.\n\n$ x + y\n\nAfter paragraph.\n"),
        ),
        (
            "many",
            String::from("$ a_ $\n\n$ \"b\n\n$ c^ $\n\n$ notdefined $\n"),
        ),
    ];

    let mut group = c.benchmark_group("delimiters");

    for (name, text) in &cases {
        group.bench_with_input(BenchmarkId::from_parameter(name), text, |b, text| {
            b.iter(|| {
                black_box(find_fixes(black_box(text)).len());
            });
        });
    }

    group.finish();
}

fn bench_compile(c: &mut Criterion) {
    if !fonts_available() {
        eprintln!("skipping compile benches: bundled fonts missing");
        return;
    }

    let cases = [
        ("plain", PLAIN.to_string()),
        ("structure", STRUCTURE.to_string()),
        ("math", MATH.to_string()),
        ("large", large_document(200)),
    ];

    let mut group = c.benchmark_group("compile_svg");
    group.sample_size(10);

    for (name, text) in &cases {
        let mut state = state();
        let id = page(&mut state, name);
        let mut next = varying(text);

        group.bench_function(BenchmarkId::from_parameter(name), |b| {
            b.iter(|| {
                let text = next();
                let render = chunk_by_items(
                    &id,
                    black_box(&text),
                    "",
                    None,
                    RenderTarget::Svg,
                    &mut state,
                );
                black_box(render.chunks.len());
            });
        });
    }

    group.finish();

    let mut group = c.benchmark_group("compile_html");
    group.sample_size(10);

    for (name, text) in &cases {
        let mut state = state();
        let id = page(&mut state, name);
        let mut next = varying(text);

        group.bench_function(BenchmarkId::from_parameter(name), |b| {
            b.iter(|| {
                let text = next();
                let render = html::render(&id, black_box(&text), "", &mut state);
                black_box(render.frames.len());
            });
        });
    }

    group.finish();

    // A notebook of 300 cells, which is the shape the editor sees in notebook
    // mode. The per-cell chrome and extraction work sits on top of this.
    let mut group = c.benchmark_group("compile_notebook");
    group.sample_size(10);

    let mut state = state();
    let id = page(&mut state, "notebook");
    let mut next = varying(&large_notebook(300));
    group.bench_function("300_cells", |b| {
        b.iter(|| {
            let text = next();
            let render = chunk_by_items(
                &id,
                black_box(&text),
                "",
                None,
                RenderTarget::Svg,
                &mut state,
            );
            black_box(render.chunks.len());
        });
    });

    group.finish();
}

fn bench_recovery(c: &mut Criterion) {
    if !fonts_available() {
        eprintln!("skipping recovery benches: bundled fonts missing");
        return;
    }

    let mut group = c.benchmark_group("recovery");
    group.sample_size(10);

    for (name, text) in [
        ("broken", BROKEN.to_string()),
        (
            "many",
            String::from("$ a_ $\n\n$ \"b\n\n$ c^ $\n\n$ notdefined $\n"),
        ),
    ] {
        let mut state = state();
        let id = page(&mut state, name);

        group.bench_with_input(BenchmarkId::from_parameter(name), &text, |b, text| {
            b.iter(|| {
                let render = chunk_by_items(
                    &id,
                    black_box(text),
                    "",
                    None,
                    RenderTarget::Svg,
                    &mut state,
                );
                black_box(render.diagnostics.len());
            });
        });
    }

    group.finish();
}

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
        "[package]\nname = \"bench\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
    );
    append(&mut builder, "lib.typ", "#let answer = 42\n");
    append(&mut builder, "src/extra.typ", "#let extra = 7\n");

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

fn bench_package(c: &mut Criterion) {
    let tarball = package_tarball();

    let mut group = c.benchmark_group("package");
    group.sample_size(20);

    group.bench_function("install", |b| {
        let mut state = TypstState::new();

        b.iter(|| {
            state
                .install_package("@preview/bench:0.1.0", black_box(tarball.clone()))
                .unwrap();
        });
    });

    group.finish();
}

/// The pure syntax passes. They run on the same text as the highlighter, so
/// sharing one parse is the difference between one parse per keystroke and four.
fn bench_syntax(c: &mut Criterion) {
    let cases = [
        ("plain", PLAIN.to_string()),
        ("structure", STRUCTURE.to_string()),
        ("large", large_document(300)),
        ("notebook_300", large_notebook(300)),
    ];

    let mut group = c.benchmark_group("syntax");
    group.sample_size(20);

    for (name, text) in &cases {
        group.bench_function(BenchmarkId::new("extract_cells", name), |b| {
            b.iter(|| black_box(extract_cells(black_box(text)).len()));
        });

        group.bench_function(BenchmarkId::new("extract_links", name), |b| {
            b.iter(|| black_box(extract_links(black_box(text)).len()));
        });

        group.bench_function(BenchmarkId::new("flatten_document", name), |b| {
            b.iter(|| black_box(flatten_document(black_box(text)).len()));
        });
    }

    // A bare parse, for the baseline the three passes above would share.
    group.bench_function("parse/notebook_300", |b| {
        b.iter(|| black_box(parse_typst(black_box(&large_notebook(300)))));
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_synth,
    bench_source_map,
    bench_delimiters,
    bench_compile,
    bench_recovery,
    bench_package,
    bench_syntax,
);
criterion_main!(benches);
