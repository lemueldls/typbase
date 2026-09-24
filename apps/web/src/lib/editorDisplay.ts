import type { EditorSettings } from "@typbase/typing";

import { Compartment, type Extension } from "@codemirror/state";
import { lineNumbers, scrollPastEnd } from "@codemirror/view";

/**
 * Display-only editor options. Both flags are off by default and live in a
 * compartment so toggling them keeps scroll position and undo history.
 */
export const editorDisplayCompartment = new Compartment();

export function editorDisplayExtension(settings: EditorSettings | undefined): Extension {
  const extensions: Extension[] = [];

  if (settings?.lineNumbers) extensions.push(lineNumbers());
  if (settings?.scrollPastEnd) extensions.push(scrollPastEnd());

  return extensions;
}
