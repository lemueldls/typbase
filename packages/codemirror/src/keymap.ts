import {
  acceptCompletion,
  closeBracketsKeymap,
  closeCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  copyLineDown,
  copyLineUp,
  indentLess,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  redoSelection,
  simplifySelection,
  standardKeymap,
  toggleBlockComment,
  toggleLineComment,
  undo,
  undoSelection,
} from "@codemirror/commands";
import { nextDiagnostic } from "@codemirror/lint";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { Facet } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import {
  cursorAddVertical,
  insertTabLike,
  toggleEmph,
  toggleStrong,
  toggleUnderline,
} from "./commands";

/**
 * Whether the editor is running vim bindings. Vim handles keys from a DOM
 * listener that CodeMirror's keymap runs before, so Escape has to be left
 * unhandled or it never reaches the vim plugin. Set through the same
 * compartment as the vim extension.
 */
export const vimKeymapFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/**
 * The app's shortcuts dialog mirrors the common entries here. When a chord
 * changes, update `EDITOR_SHORTCUTS` in `apps/web/src/lib/keybindings.ts` too.
 */
export const typstKeymap = keymap.of([
  ...completionKeymap.filter((binding) => binding.key !== "Escape"),
  ...closeBracketsKeymap,
  {
    key: "Tab",
    run: acceptCompletion,
  },
  {
    key: "Mod-z",
    run: undo,
    preventDefault: true,
  },
  {
    key: "Mod-y",
    mac: "Mod-Shift-z",
    run: redo,
    preventDefault: true,
  },
  {
    key: "Mod-Shift-z",
    run: redo,
    preventDefault: true,
  },
  {
    key: "Mod-u",
    run: undoSelection,
    preventDefault: true,
  },
  {
    key: "Alt-u",
    mac: "Mod-Shift-u",
    run: redoSelection,
    preventDefault: true,
  },
  {
    key: "Mod-/",
    run: toggleLineComment,
  },
  {
    mac: "Cmd-Alt-/",
    win: "Shift-Alt-a",
    linux: "Ctrl+Shift+a",
    run: toggleBlockComment,
  },
  {
    key: "Mod-#",
    run: toggleLineComment,
  },
  {
    key: "Mod-Shift-7",
    run: toggleLineComment,
  },
  {
    key: "Mod-Shift-/",
    run: toggleLineComment,
  },
  {
    key: "Shift-Alt-a",
    run: toggleBlockComment,
  },
  {
    key: "Mod-b",
    run: toggleStrong,
  },
  {
    key: "Mod-Shift-f",
    run: toggleStrong,
  },
  {
    key: "Mod-i",
    run: toggleEmph,
  },
  {
    key: "Mod-Shift-K",
    run: toggleEmph,
  },
  {
    key: "Mod-u",
    run: toggleUnderline,
  },
  {
    key: "Alt-ArrowUp",
    run: moveLineUp,
  },
  {
    key: "Shift-Alt-ArrowUp",
    run: copyLineUp,
  },
  {
    key: "Alt-ArrowDown",
    run: moveLineDown,
  },
  {
    key: "Shift-Alt-ArrowDown",
    run: copyLineDown,
  },
  {
    key: "Tab",
    run: insertTabLike,
    shift: indentLess,
  },
  {
    key: "Mod-Enter",
    run: insertBlankLine,
  },
  {
    key: "F8",
    run: nextDiagnostic,
  },
  {
    key: "Mod-g",
    run: gotoLine,
    scope: "editor goto-panel search-panel",
  },
  {
    key: "Escape",
    run: (view) => {
      if (view.state.facet(vimKeymapFacet)) {
        // Dismiss a completion but leave Escape for vim to exit insert mode.
        closeCompletion(view);

        return false;
      }

      return closeCompletion(view) || simplifySelection(view);
    },
  },
  {
    key: "Mod-Alt-ArrowUp",
    run: (n) => cursorAddVertical(n, -1),
  },
  {
    key: "Mod-Alt-ArrowDown",
    run: (n) => cursorAddVertical(n, 1),
  },
  {
    key: "Mod-f",
    run: openSearchPanel,
    scope: "editor search-panel goto-panel",
  },
  {
    key: "F3",
    run: findNext,
    shift: findPrevious,
    scope: "editor search-panel",
    preventDefault: true,
  },
  {
    key: "Escape",
    run: closeSearchPanel,
    scope: "editor search-panel",
  },
  {
    key: "Mod-Shift-l",
    run: selectSelectionMatches,
  },
  {
    key: "Mod-d",
    run: selectNextOccurrence,
    preventDefault: true,
  },
  ...standardKeymap.filter((binding) => binding.key !== "Escape"),
]);
