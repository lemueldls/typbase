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
  let codeSpans: ReturnType<TypstState["extractCodeSpans"]>;
  try {
    tokens = typstState.highlight(fileId, state.doc.toString());
    // The highlight pass just parsed this text, so the span walks reuse the
    // cached tree. `typ-equation` covers the whole `$...$` and `typ-code`
    // covers each embedded expression, so text without a token class follows
    // the font too.
    equations = typstState.extractEquations(fileId, state.doc.toString());
    codeSpans = typstState.extractCodeSpans(fileId, state.doc.toString());
  } catch (error) {
    console.error("[typst] highlight panicked:", error);

    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const equationMark = Decoration.mark({ class: "typ-equation" });
  const codeMark = Decoration.mark({ class: "typ-code" });
  // Outer spans nest inside each other and around the tokens, so they go in
  // by start offset and widest first.
  const spans = [
    ...codeSpans.map((span) => ({ ...span, mark: codeMark })),
    ...equations.map((span) => ({ ...span, mark: equationMark })),
  ].sort((a, b) => a.from - b.from || b.to - a.to);
  let nextSpan = 0;

  for (const token of tokens) {
    while (nextSpan < spans.length && spans[nextSpan]!.from <= token.range.start) {
      const span = spans[nextSpan++]!;
      builder.add(span.from, span.to, span.mark);
    }

    builder.add(token.range.start, token.range.end, Decoration.mark({ class: token.tag }));
  }

  for (; nextSpan < spans.length; nextSpan++) {
    const span = spans[nextSpan]!;
    builder.add(span.from, span.to, span.mark);
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
