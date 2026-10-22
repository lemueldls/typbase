import type { IndentContext } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { FileId, TypstState } from "@typbase/engine";

import { autocompletion } from "@codemirror/autocomplete";
import { indentService } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

import type { NotebookOptions } from "./notebook";
import type { TextRef } from "./types";
import type { TypstRequestHandler } from "./types";

import { typstSyntaxHighlighting } from "./highlight";
import { typstHoverTooltip } from "./hover";
import { typstKeymap } from "./keymap";
import { autocomplete, typstLanguageData } from "./language";
import { notebookKeymap, notebookOptionsFacet } from "./notebook";
import { typstSourceSync } from "./sync";
import { tooltipStateField, tooltipViewPlugin } from "./tooltip";
import { typstStateField, typstViewPlugin, tooltipsStateField } from "./widgets";

const bracketPairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", $: "$" };

/**
 * Typing a space with the caret between `(` and `)`, `[` and `]`, `{` and `}`,
 * or two `$` pads the empty pair: two spaces go in before the closer and the
 * caret lands between them, so typing `x` gives `( x )`. Returning true stops
 * CodeMirror's default insertion, which would otherwise add a third space.
 *
 * The insertion point comes from the state selection, not from the DOM change.
 * After an auto-closed bracket the DOM selection can still sit at the end of
 * the pair while `drawSelection` already paints the caret between them, so the
 * DOM position would put the space after the closer.
 */
const addSpaceBeforeClosingBracket = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to) return false;

  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;

  const pos = main.head;
  const before = state.doc.sliceString(pos - 1, pos);
  const after = state.doc.sliceString(pos, pos + 1);

  if (!bracketPairs[before] || after !== bracketPairs[before]) return false;

  view.dispatch({
    changes: { from: pos, to: pos, insert: "  " },
    selection: { anchor: pos + 1 },
  });

  return true;
});

export const typstEditingExtensions: Extension = [
  addSpaceBeforeClosingBracket,
  indentService.of((ctx: IndentContext, pos: number): number => {
    const last = Math.max(0, pos - 1);
    const prev = ctx.lineAt(last).text;
    if (prev.endsWith("$") && prev !== "$") return 0;

    const indent = /[{[($]\s*$/.test(prev);

    return ctx.lineIndent(last) + (indent ? ctx.unit : 0);
  }),
];

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
   * the editor. The plugin drops the decorations for the failed pass.
   */
  onPanic?: (fileId: FileId) => void;
  /** Called after a compile pass succeeds. The host resets its health and
   *  heap watchdog on it. */
  onCompile?: () => void;
  /**
   * Opens a link clicked inside a rendered frame. Defaults to a new browser
   * tab. The app passes its Tauri-aware `openExternal`.
   */
  onExternalLink?: (url: string) => void;
  /**
   * Cell rendering and cell commands. When set, the editor behaves like a
   * notebook: prose cells render inline, code cells render below, and the
   * notebook keymap takes precedence over the line editing bindings.
   */
  notebook?: NotebookOptions;
  /**
   * Draw the frames, or show plain source. Defaults to true. A notebook page in
   * source mode passes false: the cells and their rails stay, but nothing is
   * rendered, which is the only difference between its write and source modes.
   */
  renderFrames?: boolean;
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
): Extension => {
  const extensions: Extension[] = [
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
    typstSourceSync(fileId, prelude, typstState),
    typstSyntaxHighlighting(fileId, typstState),
    typstHoverTooltip(fileId, typstState),

    typstEditingExtensions,
  ];

  if (options.notebook) {
    // High precedence: Alt-Arrow moves cells and Escape reaches command mode
    // instead of the line-editing bindings in typstKeymap.
    extensions.push(notebookOptionsFacet.of(options.notebook), notebookKeymap);
  }

  return extensions;
};
