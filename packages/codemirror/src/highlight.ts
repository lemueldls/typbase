import type { EditorState } from "@codemirror/state";
import type { FileId, TypstState } from "@typbase/engine";

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const typstSyntaxHighlighting = (fileId: FileId, typstState: TypstState) =>
  StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, fileId, typstState);
    },
    update(decoration, transaction) {
      if (transaction.docChanged) return buildDecorations(transaction.state, fileId, typstState);

      return decoration;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

function buildDecorations(
  state: EditorState,
  fileId: FileId,
  typstState: TypstState,
): DecorationSet {
  let tokens: ReturnType<TypstState["highlight"]>;
  let equations: ReturnType<TypstState["extractEquations"]>;
  try {
    tokens = typstState.highlight(fileId, state.doc.toString());
    // The highlight pass just parsed this text, so the equation walk reuses
    // the cached tree. A mark over the whole equation lets math use the
    // monospaced face while prose keeps the workspace text font.
    equations = typstState.extractEquations(fileId, state.doc.toString());
  } catch (error) {
    console.error("[typst] highlight panicked:", error);

    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const equationMark = Decoration.mark({ class: "typ-equation" });
  let nextEquation = 0;

  // Equations start at or before their tokens (the opening `$`). Emitting the
  // outer mark first keeps the builder's start-offset ordering.
  for (const token of tokens) {
    while (nextEquation < equations.length && equations[nextEquation]!.from <= token.range.start) {
      const equation = equations[nextEquation++]!;
      builder.add(equation.from, equation.to, equationMark);
    }

    builder.add(token.range.start, token.range.end, Decoration.mark({ class: token.tag }));
  }

  for (; nextEquation < equations.length; nextEquation++) {
    const equation = equations[nextEquation]!;
    builder.add(equation.from, equation.to, equationMark);
  }

  return builder.finish();
}

export const parseBackticks = (str: string, into: HTMLElement) => {
  const result = str.split("`").map((sub, i) => {
    if (i % 2) {
      const code = document.createElement("code");
      code.textContent = sub;

      return code;
    }

    return document.createTextNode(sub);
  });

  into.append(...result);
};
