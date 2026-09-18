//! Characterization tests. These print what the parser and the current
//! render path do with the broken fixtures; they are the evidence behind the
//! recovery rules. Run with `-- --nocapture` to read the dumps.

use typst_syntax::{LinkedNode, SyntaxKind};

use crate::tests::{fixtures, harness};

fn dump_tree(node: &LinkedNode, depth: usize, out: &mut String) {
    let indent = "  ".repeat(depth);
    let leaf = node.get().leaf_text();

    out.push_str(&format!("{indent}{:?} {:?}", node.kind(), node.range()));
    if !leaf.is_empty() {
        out.push_str(&format!(" {leaf:?}"));
    }
    out.push('\n');

    for child in node.children() {
        dump_tree(&child, depth + 1, out);
    }
}

#[test]
fn dump_broken_math_trees() {
    for fixture in fixtures::BROKEN_MATH {
        let root = typst_syntax::parse(fixture.source);
        let linked = LinkedNode::new(&root);
        let mut out = String::new();
        dump_tree(&linked, 0, &mut out);

        println!("===== {} =====\n{out}", fixture.name);
    }
}

#[test]
fn dump_equation_kinds() {
    for fixture in fixtures::BROKEN_MATH {
        let root = typst_syntax::parse(fixture.source);
        let mut equations = Vec::new();

        let mut stack = vec![LinkedNode::new(&root)];
        while let Some(node) = stack.pop() {
            if node.kind() == SyntaxKind::Equation || node.kind().is_error() {
                equations.push(format!(
                    "{:?} {:?} {:?}",
                    node.kind(),
                    node.range(),
                    node.get().full_text(),
                ));
            }
            stack.extend(node.children());
        }

        equations.sort();
        println!("===== {} =====\n{}", fixture.name, equations.join("\n"));
    }
}

#[test]
fn characterize_render_status() {
    if !harness::fonts_available() {
        eprintln!("skipping render characterization: bundled fonts missing");
        return;
    }

    for fixture in fixtures::CLEAN.iter().chain(fixtures::BROKEN_MATH) {
        let mut state = harness::state();
        let id = harness::page(&mut state, fixture.name);
        let render = harness::compile(&mut state, &id, fixture.source);

        println!(
            "===== {} ===== document={} chunks={} tooltips={} diagnostics={:#?}",
            fixture.name,
            render.document.is_some(),
            render.chunks.len(),
            render.tooltips.len(),
            render.diagnostics,
        );
    }
}
