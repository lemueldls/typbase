import type { FileId, TypstState } from "@typbase/engine";

import { type Extension, EditorState } from "@codemirror/state";

import type { TextRef } from "./types";

/**
 * Keeps the engine's sources in step with the editor, without rendering.
 */
export const typstSourceSync = (
  fileId: FileId,
  prelude: TextRef,
  typstState: TypstState,
): Extension =>
  EditorState.transactionExtender.of((transaction) => {
    if (!transaction.docChanged) return null;

    try {
      typstState.syncSource(fileId, transaction.newDoc.toString(), prelude.value);
    } catch (error) {
      console.error("[typst] source sync panicked:", error);
    }

    return null;
  });
