//! The shared SVG definitions.
//!
//! The SVG exporter writes a private `<defs>` into every frame, so a prose note
//! serializes the same glyph outline once per block that uses the character.
//! `share_frame_defs` moves them into one block the host places in the document,
//! and the frames reference into it. These tests pin the properties that makes it
//! safe, because the failure mode is a frame that silently draws no text.

use std::collections::HashSet;

use crate::{renderer::paged::svg::SvgRender, tests::harness};

/// Twelve distinct paragraphs, which is enough glyph variety to make the
/// duplication measurable and small enough to stay quick.
const PARAGRAPHS: usize = 12;

fn prose(blocks: usize) -> String {
    let mut out = String::new();

    for i in 0..blocks {
        out.push_str(&format!("P{i} alpha beta gamma delta epsilon.\n\n"));
    }

    out
}

/// Renders `blocks` paragraphs and answers the shared definitions. A document
/// with no text has none, so a `None` is a real signal.
fn render(blocks: usize) -> SvgRender {
    let mut state = harness::state();
    let source = prose(blocks);
    let id = harness::page(&mut state, "shared_defs");

    harness::compile_svg(&mut state, &id, &source)
}

/// The ids a block of markup references through `href="#…"`.
fn referenced(svg: &str) -> HashSet<&str> {
    let mut ids = HashSet::new();
    let mut rest = svg;

    while let Some(at) = rest.find("href=\"#") {
        rest = &rest[at + "href=\"#".len()..];

        if let Some(end) = rest.find('"') {
            ids.insert(&rest[..end]);
            rest = &rest[end..];
        }
    }

    ids
}

/// The ids a block of definitions declares.
fn declared(defs: &str) -> HashSet<&str> {
    let mut ids = HashSet::new();
    let mut rest = defs;

    while let Some(at) = rest.find("id=\"") {
        rest = &rest[at + "id=\"".len()..];

        if let Some(end) = rest.find('"') {
            ids.insert(&rest[..end]);
            rest = &rest[end..];
        }
    }

    ids
}

/// Every id a frame references has to be declared in the shared block. A frame
/// pointing at a missing glyph draws nothing at all and reports no error, so
/// this is the property the whole optimization rests on.
#[test]
fn every_referenced_glyph_is_declared() {
    if !harness::fonts_available() {
        return;
    }

    let render = render(PARAGRAPHS);
    let defs = render.defs.as_deref().expect("text produces definitions");
    let declared = declared(defs);

    assert!(!declared.is_empty(), "the shared block declares nothing");
    assert!(!render.frames.is_empty(), "the fixture produced no frames");

    for frame in &render.frames {
        let missing: Vec<_> = referenced(&frame.render.svg)
            .into_iter()
            .filter(|id| !declared.contains(id))
            .collect();

        assert!(
            missing.is_empty(),
            "a frame references undefined definitions: {missing:?}",
        );
    }
}

/// The frames stopped being self-contained, which is the whole point, and the
/// host's contract is that it places the shared block.
#[test]
fn frames_carry_no_definitions_of_their_own() {
    if !harness::fonts_available() {
        return;
    }

    for frame in render(PARAGRAPHS).frames {
        assert!(
            !frame.render.svg.contains("<defs"),
            "a frame still carries its own definitions",
        );
    }
}

/// The tooltip frames are left alone on purpose: they render for whichever
/// equation the caret is in, so their glyphs need not be in the frame set, and
/// a frame set from an earlier compile would leave them blank.
#[test]
fn tooltip_frames_keep_their_definitions() {
    if !harness::fonts_available() {
        return;
    }

    let mut state = harness::state();
    let source = "= Sum\n\n$ sum_(i = 1)^n i = (n (n + 1)) / 2 $ and $ x^2 $.\n";
    let id = harness::page(&mut state, "tooltip_defs");
    let render = harness::compile_svg(&mut state, &id, source);

    let tooltip = render
        .tooltips
        .iter()
        .find(|frame| frame.render.svg.contains("<defs"))
        .expect("an equation tooltip should still carry its definitions");

    for id in referenced(&tooltip.render.svg) {
        assert!(
            declared(tooltip.render.svg.as_str()).contains(id),
            "a tooltip references a definition it does not carry: {id}",
        );
    }
}

/// The exporter names a definition `hash128` of `(font, glyph, scale)`, so two
/// frames agreeing on an id cannot disagree about what it is. That is what lets
/// one block serve every document in the app rather than one per note, and it
/// shows up here as the shared block having no repeated ids.
#[test]
fn the_shared_block_declares_each_id_once() {
    if !harness::fonts_available() {
        return;
    }

    let render = render(PARAGRAPHS);
    let defs = render.defs.as_deref().expect("text produces definitions");

    assert_eq!(
        defs.matches("id=\"").count(),
        declared(defs).len(),
        "the shared block repeats a definition",
    );
}

/// What the change buys: the payload stops being dominated by duplicated
/// outlines. The per-frame cost was about 12.5 KB of definitions for roughly
/// 2.5 KB of content, so a 3000-block note cost 45 MB where the content was
/// about 8 MB. The frames still grow with the text, so this is loose on purpose
/// and fails only if the per-frame definitions come back.
#[test]
fn per_frame_cost_does_not_grow_with_the_document() {
    if !harness::fonts_available() {
        return;
    }

    let payload = |blocks: usize| {
        let render = render(blocks);
        let frames = render.frames.len().max(1);
        let bytes: usize = render
            .frames
            .iter()
            .map(|frame| frame.render.svg.len())
            .sum::<usize>()
            + render.defs.as_deref().map_or(0, str::len);

        (bytes / frames, frames)
    };

    let (small, small_frames) = payload(10);
    let (large, large_frames) = payload(100);

    assert!(
        large_frames > small_frames * 5,
        "the fixture did not grow: {small_frames} vs {large_frames} frames",
    );
    assert!(
        large <= small * 2,
        "per-frame cost grew with the document: {small} B -> {large} B",
    );
}
