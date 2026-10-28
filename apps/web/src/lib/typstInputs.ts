import type { TypstState } from "@typbase/engine";

/**
 * Host values for `sys.inputs`, set before a compile. The engine bakes them
 * into the library, so a change drops memoized compiles: set them when the
 * page or the reason changes, not per keystroke.
 */

/** Why a compile runs. Documents can branch on `sys.inputs.reason`. */
export type CompileReason = "editor" | "resolve" | "render" | "chat";

/** Which renderer is asking. `html` cannot lay out CeTZ/Fletcher content. */
export type CompileTarget = "html" | "paged";

export function setTypstInputs(
  state: TypstState,
  input: {
    pageId?: string | null;
    workspaceId?: string | null;
    reason: CompileReason;
    target: CompileTarget;
  },
): void {
  state.setInputs(input.pageId ?? null, input.workspaceId ?? null, input.reason, input.target);
}
