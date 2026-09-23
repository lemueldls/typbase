import type { Action, Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { IgnoredSpellcheckLint, SpellcheckMode } from "@typbase/typing";
import type { Lint } from "harper.js";

import { linter } from "@codemirror/lint";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  dictionaryWord,
  ignoredLintsJson,
  normalizeDictionaryWords,
} from "~/lib/spellcheckSettings";

export const spellcheckCompartment = new Compartment();

/** Mirror of harper.js's SuggestionKind, kept local so this module can load
 *  without pulling the linter in. */
const SUGGESTION_REMOVE = 1;
const SUGGESTION_INSERT_AFTER = 2;

/** Kinds the user dictionary can fix; everything else is "Ignore" territory. */
const SPELLING_KINDS = new Set(["Spelling", "Typo"]);

export interface SpellcheckOptions {
  /** Harper's user dictionary; unused by the native checker. */
  words?: readonly string[];
  /** Silenced lints; unused by the native checker. */
  ignoredLints?: readonly IgnoredSpellcheckLint[];
  /** Adds one word to the workspace dictionary (the lint tooltip action). */
  onAddWord?: (word: string) => void;
  /** Silences one lint in the workspace (the lint tooltip action). */
  onIgnoreLint?: (lint: IgnoredSpellcheckLint) => void;
}

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

/** Last state pushed into the worker, so unchanged lint runs skip the RPCs. */
let appliedWords: string[] = [];
let appliedIgnored = ignoredLintsJson([]);
/** Serializes dictionary updates against concurrent lint runs. */
let harperSync: Promise<void> = Promise.resolve();

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

/**
 * Pushes the workspace dictionary and ignored lints into the shared worker.
 * `clearWords`/`importWords` and their ignore counterparts are expensive, so
 * they only run when the lists changed, and the calls are chained because two
 * editors linting at once must not interleave clear/import pairs.
 */
function syncHarper(
  words: readonly string[],
  ignoredLints: readonly IgnoredSpellcheckLint[],
): Promise<void> {
  const nextWords = normalizeDictionaryWords(words);
  const nextIgnored = ignoredLintsJson(ignoredLints);
  if (sameWords(nextWords, appliedWords) && nextIgnored === appliedIgnored) return harperSync;

  harperSync = harperSync.then(async () => {
    try {
      const worker = await harperLinter();

      if (!sameWords(nextWords, appliedWords)) {
        await worker.clearWords();
        if (nextWords.length) await worker.importWords(nextWords);
        appliedWords = nextWords;
      }

      if (nextIgnored !== appliedIgnored) {
        await worker.clearIgnoredLints();
        try {
          await worker.importIgnoredLints(nextIgnored);
        } catch (cause) {
          // Harper owns this format; a shape change must not take spelling down.
          console.error("[spellcheck] ignored lints import failed:", cause);
        }
        appliedIgnored = nextIgnored;
      }
    } catch (cause) {
      // Leave the applied state stale so the next lint run retries.
      console.error("[spellcheck] dictionary sync failed:", cause);
    }
  });

  return harperSync;
}

function severityFor(kind: string): Diagnostic["severity"] {
  return SPELLING_KINDS.has(kind) ? "info" : "warning";
}

function actionName(kind: number, replacement: string): string {
  if (kind === SUGGESTION_REMOVE) return "Remove";
  if (kind === SUGGESTION_INSERT_AFTER) return `Insert "${replacement}"`;

  return `Replace with "${replacement}"`;
}

/** Silences a lint through the worker, then hands the settings entry back. */
async function ignoreLint(
  source: string,
  lint: Lint,
  onIgnoreLint: (entry: IgnoredSpellcheckLint) => void,
): Promise<void> {
  try {
    const hash = await (await harperLinter()).contextHash(source, lint);
    onIgnoreLint({
      hash: hash.toString(),
      kind: lint.lint_kind(),
      message: lint.message(),
      text: lint.get_problem_text(),
    });
  } catch (cause) {
    console.error("[spellcheck] ignoring lint failed:", cause);
  }
}

function toDiagnostic(
  doc: Text,
  source: string,
  lint: Lint,
  options: SpellcheckOptions,
): Diagnostic {
  const span = lint.span();
  const from = Math.max(0, Math.min(span.start, doc.length));
  const to = Math.max(from, Math.min(span.end, doc.length));
  const kind = lint.lint_kind();

  const actions: Action[] = lint.suggestions().map((suggestion) => {
    const replacement = suggestion.get_replacement_text();
    const suggestionKind: number = suggestion.kind();

    return {
      name: actionName(suggestionKind, replacement),
      apply(view, actionFrom, actionTo) {
        if (suggestionKind === SUGGESTION_INSERT_AFTER) {
          view.dispatch({ changes: { from: actionTo, insert: replacement } });
          return;
        }

        view.dispatch({
          changes: {
            from: actionFrom,
            to: actionTo,
            insert: suggestionKind === SUGGESTION_REMOVE ? "" : replacement,
          },
        });
      },
    };
  });

  if (SPELLING_KINDS.has(kind)) {
    const word = dictionaryWord(doc.sliceString(from, to));
    if (word && options.onAddWord) {
      actions.push({
        name: `Add "${word}" to dictionary`,
        apply() {
          options.onAddWord?.(word);
        },
      });
    }
  } else if (options.onIgnoreLint) {
    const { onIgnoreLint } = options;
    actions.push({
      name: "Ignore",
      apply() {
        void ignoreLint(source, lint, onIgnoreLint);
      },
    });
  }

  return {
    from,
    to,
    severity: severityFor(kind),
    message: lint.message(),
    actions,
  };
}

function harperSource(options: SpellcheckOptions): Extension {
  return linter(
    async (view) => {
      const text = view.state.doc.toString();
      if (!text.trim()) return [];

      await syncHarper(options.words ?? [], options.ignoredLints ?? []);
      const lints = await (await harperLinter()).lint(text, { language: "typst" });

      return lints.map((lint) => toDiagnostic(view.state.doc, text, lint, options));
    },
    { delay: 800 },
  );
}

/** Spellcheck extension for one mode; off returns an empty extension. */
export function spellcheckExtension(
  mode: SpellcheckMode | undefined,
  options: SpellcheckOptions = {},
): Extension {
  if (mode === "native") return EditorView.contentAttributes.of({ spellcheck: "true" });
  if (mode === "harper") return harperSource(options);

  return [];
}
