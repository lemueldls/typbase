import type { EditorSettings } from "@typbase/typing";

import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, scrollPastEnd } from "@codemirror/view";

/**
 * Display-only editor options. They live in a compartment so toggling them
 * keeps scroll position and undo history.
 */
export const editorDisplayCompartment = new Compartment();

export function editorDisplayExtension(settings: EditorSettings | undefined): Extension {
  const extensions: Extension[] = [];

  if (settings?.softWrap === false) {
    // The class flips the scroller to horizontal overflow; the base theme
    // hides it because wrapped lines normally leave nothing to scroll.
    extensions.push(EditorView.editorAttributes.of({ class: "cm-soft-wrap-off" }));
  } else {
    extensions.push(EditorView.lineWrapping);
  }
  if (settings?.lineNumbers) extensions.push(lineNumbers());
  if (settings?.scrollPastEnd) extensions.push(scrollPastEnd());

  return extensions;
}
