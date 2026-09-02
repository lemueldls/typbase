import type { IndentContext } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { FileId, TypstState } from "@typbase/wasm";

import { autocompletion } from "@codemirror/autocomplete";
import { indentService } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

import type { TextRef } from "./types";
import type { TypstRequestHandler } from "./widgets";

import { typstSyntaxHighlighting } from "./highlight";
import { typstHoverTooltip } from "./hover";
import { typstKeymap } from "./keymap";
import { autocomplete, typstLanguageData } from "./language";
import { tooltipStateField, tooltipViewPlugin } from "./tooltip";
import { typstStateField, typstViewPlugin, tooltipsStateField } from "./widgets";

export interface TypstPluginOptions {
  /**
   * Called when Typst needs a source, file, or package that is not loaded
   * yet. Return true when the request caused the world to change, so the
   * editor recompiles.
   */
  onRequests?: TypstRequestHandler;
  /** The revision of the document. */
  revision?: () => string | number | undefined;
  /**
   * Called when a compile into the wasm instance threw. On wasm32 a panic
   * aborts the instance, so the host must recreate `typstState` and remount
   * the editor; the plugin drops the decorations for the failed pass.
   */
  onPanic?: (fileId: FileId) => void;
}

export const typstPlugin = (
  fileId: FileId,
  spaceId: string,
  path: string,
  text: TextRef,
  prelude: TextRef,
  locked: boolean,
  typstState: TypstState,
  options: TypstPluginOptions = {},
): Extension => [
  typstStateField,
  tooltipsStateField,
  typstViewPlugin(fileId, spaceId, path, text, prelude, locked, typstState, options),
  tooltipViewPlugin(),
  tooltipStateField,

  autocompletion({
    override: [(context) => autocomplete(context, fileId, typstState)],
  }),

  typstKeymap,
  typstLanguageData,
  typstSyntaxHighlighting(fileId, typstState),
  typstHoverTooltip(fileId, typstState),

  addSpaceBeforeClosingBracket,
  indentService.of((ctx: IndentContext, pos: number): number => {
    const last = Math.max(0, pos - 1);
    const prev = ctx.lineAt(last).text;
    if (prev.endsWith("$") && prev !== "$") return 0;

    const indent = /[{[($]\s*$/.test(prev);

    return ctx.lineIndent(last) + (indent ? ctx.unit : 0);
  }),
];

const addSpaceBeforeClosingBracket = EditorView.inputHandler.of((view, from, to, text) => {
  if (text === " ") {
    const { state } = view;
    const pos = from;
    const bracketPairs = { "(": ")", "[": "]", "{": "}", $: "$" };
    const before = state.doc.sliceString(pos - 1, pos) as keyof typeof bracketPairs;
    const after = state.doc.sliceString(pos, pos + 1) as keyof typeof bracketPairs;

    if (bracketPairs[before] && after === bracketPairs[before]) {
      // Insert a space before the closing bracket
      view.dispatch({
        changes: { from: pos, to: pos, insert: " " },
        selection: { anchor: pos + 1 },
      });
    }
  }

  return false;
});
