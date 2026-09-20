import type { EditorView } from "@codemirror/view";
import type { WorkspaceStore } from "@typbase/storage";
import type { FileId } from "@typbase/wasm";

/**
 * Dev-only handles for the demo capture script and e2e tests. Components write
 * into this object as they mount, so a script can drive the app without
 * reaching into the DOM for state. Production builds never expose it.
 */
export interface TypbaseTestApi {
  /** The open workspace store, or null before one loads. */
  store: WorkspaceStore | null;
  /** The editor view of the open page, or null. */
  view: EditorView | null;
  /** The engine file id behind the open page, or null. */
  fileId: FileId | null;
  /** The active page id, or null. */
  pageId: string | null;
  /** Navigate without a reload. */
  openPage: ((id: string) => void) | null;
  /** Switch view mode without a reload. */
  setMode: ((mode: string) => void) | null;
}

export const testApi: TypbaseTestApi = {
  store: null,
  view: null,
  fileId: null,
  pageId: null,
  openPage: null,
  setMode: null,
};

if (import.meta.dev && typeof window !== "undefined") {
  (window as unknown as { __typbase: TypbaseTestApi }).__typbase = testApi;
}
