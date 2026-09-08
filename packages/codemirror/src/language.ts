import type { EditorView } from "@codemirror/view";
import type { FileId, TypstState } from "@typbase/wasm";

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

export async function autocomplete(
  context: CompletionContext,
  fileId: FileId,
  typstState: TypstState,
): Promise<CompletionResult | null> {
  const { pos, explicit } = context;
  const result = typstState.autocomplete(fileId, pos, explicit);
  if (!result) return null;

  const { offset, completions } = result;

  return {
    from: offset,
    options: completions.map((completion) => {
      const type =
        typeof completion.type === "object" ? "symbol" : completion.type;
      const complete: Completion = {
        type,
        apply: completion.apply,
        label: completion.label,
        info: completion.detail,
      };

      if (completion.apply?.includes("$")) {
        const tt =
            completion.apply.match(/\$\{\w*\}/)?.at(0) == "${}" &&
            (completion.type !== "syntax" || completion.label != "linebreak"),
          applySnippet = snippet(completion.apply);

        complete.apply = (
          applyView: EditorView,
          applyCompletion: Completion,
          from: number,
          to: number,
        ) => {
          applySnippet(applyView, applyCompletion, from, to);
          if (tt) startCompletion(applyView);
        };
      }

      return complete;
    }),
  };
}

export const typstLanguageData = EditorState.languageData.of(() => [
  {
    closeBrackets: {
      brackets: ["(", "[", "{", '"', "`", "$"],
      before: ')]}"`$,;',
    },
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    wordChars: "-_",
    indentOnInput: /^\s*[[\]{}()$]$/,
  },
]);
