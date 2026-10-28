import type { Diagnostic } from "@codemirror/lint";

import { linter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  mergeTypstDiagnostics,
  TYPST_LINT_MARK,
} from "../../../packages/codemirror/src/diagnostics";

function linted(diagnostics: Diagnostic[]): EditorState {
  const state = EditorState.create({
    doc: "helo wrld",
    extensions: [linter(() => [])],
  });

  return state.update(setDiagnostics(state, diagnostics)).state;
}

describe("mergeTypstDiagnostics", () => {
  it("replaces Typst lints and keeps diagnostics from other sources", () => {
    const before = linted([
      {
        from: 0,
        to: 4,
        severity: "error",
        message: "old typst",
        markClass: TYPST_LINT_MARK,
      },
      { from: 5, to: 9, severity: "info", message: "spelling" },
    ]);
    // Diagnostics map through an edit; the compile result for the new text
    // should not drop the spellcheck mark or reuse its old range.
    const state = before.update({ changes: { from: 0, insert: "x" } }).state;

    const merged = mergeTypstDiagnostics(state, [
      {
        range: { start: 0, end: 5 },
        severity: "warning",
        message: "new typst",
        hints: [],
      },
    ]);

    expect(merged.map((diagnostic) => diagnostic.message)).toEqual(["spelling", "new typst"]);
    expect(merged[0]).toMatchObject({ from: 6, to: 10 });
    expect(merged[1]).toMatchObject({
      from: 0,
      to: 5,
      markClass: TYPST_LINT_MARK,
    });
  });
});
