import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { SpellcheckMode } from "@typbase/typing";
import type { Lint } from "harper.js";

import { linter } from "@codemirror/lint";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const spellcheckCompartment = new Compartment();

/** Mirror of harper.js's SuggestionKind, kept local so this module can load
 *  without pulling the linter in. */
const SUGGESTION_REMOVE = 1;
const SUGGESTION_INSERT_AFTER = 2;

let harper: Promise<import("harper.js").WorkerLinter> | undefined;

/** Loads the checker on first use; off means the chunk is never fetched. */
function harperLinter(): Promise<import("harper.js").WorkerLinter> {
  harper ??= (async () => {
    const [{ WorkerLinter }, { binaryInlined }] = await Promise.all([
      import("harper.js"),
      import("harper.js/binaryInlined"),
    ]);
    const instance = new WorkerLinter({ binary: binaryInlined });
    await instance.setup();

    return instance;
  })();

  return harper;
}

function severityFor(kind: string): Diagnostic["severity"] {
  return kind === "Spelling" || kind === "Typo" ? "info" : "warning";
}

function actionName(kind: number, replacement: string): string {
  if (kind === SUGGESTION_REMOVE) return "Remove";
  if (kind === SUGGESTION_INSERT_AFTER) return `Insert "${replacement}"`;

  return `Replace with "${replacement}"`;
}

function toDiagnostic(doc: Text, lint: Lint): Diagnostic {
  const span = lint.span();
  const from = Math.max(0, Math.min(span.start, doc.length));
  const to = Math.max(from, Math.min(span.end, doc.length));

  return {
    from,
    to,
    severity: severityFor(lint.lint_kind()),
    message: lint.message(),
    actions: lint.suggestions().map((suggestion) => {
      const replacement = suggestion.get_replacement_text();
      const kind: number = suggestion.kind();

      return {
        name: actionName(kind, replacement),
        apply(view, actionFrom, actionTo) {
          if (kind === SUGGESTION_INSERT_AFTER) {
            view.dispatch({ changes: { from: actionTo, insert: replacement } });
            return;
          }

          view.dispatch({
            changes: {
              from: actionFrom,
              to: actionTo,
              insert: kind === SUGGESTION_REMOVE ? "" : replacement,
            },
          });
        },
      };
    }),
  };
}

const harperSource = linter(
  async (view) => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];

    const lints = await (await harperLinter()).lint(text, { language: "typst" });

    return lints.map((lint) => toDiagnostic(view.state.doc, lint));
  },
  { delay: 800 },
);

/** Spellcheck extension for one mode; off returns an empty extension. */
export function spellcheckExtension(mode: SpellcheckMode | undefined): Extension {
  if (mode === "native") return EditorView.contentAttributes.of({ spellcheck: "true" });
  if (mode === "harper") return harperSource;

  return [];
}
