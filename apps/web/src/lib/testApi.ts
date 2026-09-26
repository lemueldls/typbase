import type { EditorView } from "@codemirror/view";
import type { FileId } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { ChatMessage } from "@typbase/typing";

import type { AiProvider } from "~/lib/ai/providers";

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
  /** The view mode PageView is currently in. */
  mode: (() => string) | null;
  /** Engine health status: "ok" | "recovering" | "failed". */
  engineStatus: (() => string) | null;
  /** Wasm heap size in bytes, for leak checks. */
  engineMemory: (() => number) | null;
  /** Crash the wasm engine on purpose. Debug wasm builds only. */
  crashEngine: (() => void) | null;
  /** Open the chat pane, on a thread id or the most recent thread. */
  openChat: ((threadId?: string | null) => void) | null;
  /** Open the graph pane. */
  openGraph: (() => void) | null;
  /** Node and edge counts of the open graph, or null when it is closed. */
  graphStats: (() => { nodes: number; edges: number } | null) | null;
  /** Source page ids that link the given page, for link/backlink checks. */
  backlinksFor: ((pageId: string) => string[]) | null;
  /** Create a chat thread and return its id. */
  newChat: ((pageId?: string | null) => Promise<string>) | null;
  /** Send a chat message and wait for the reply flow to settle. */
  sendChat: ((threadId: string, text: string) => Promise<void>) | null;
  /** Read a thread's messages. */
  chatMessages: ((threadId: string) => Promise<ChatMessage[]>) | null;
  /** Stream from this provider instead of the configured one. */
  setAiStub: ((provider: AiProvider | null) => void) | null;
  /** Open a plugin instance: pane when it has one, window otherwise. */
  openPlugin: ((instanceId: string) => void) | null;
  /** Install a catalog plugin and return its first instance id. */
  installPlugin: ((pluginId: string) => Promise<string>) | null;
  /** Render status of one surface: "ok", "error", or null before a render. */
  pluginStatus: ((instanceId: string, kind: string) => string | null) | null;
  /** Sanitized HTML of the last render of one surface. */
  pluginHtml: ((instanceId: string, kind: string) => string) | null;
  /** Dispatch a plugin or host action and wait for the render queue. */
  pluginAction:
    | ((
        instanceId: string,
        kind: string,
        name: string,
        args?: Record<string, unknown>,
        fields?: Record<string, unknown>,
      ) => Promise<void>)
    | null;
  /** Whether an instance's floating window is open. */
  pluginWindowOpen: ((instanceId: string) => boolean) | null;
  /** Read a plugin instance's synced records. */
  pluginState: ((instanceId: string) => Promise<Record<string, unknown[]>>) | null;
  /** Write a file under the workspace root (e2e seeds broken plugins). */
  writeWorkspaceFile: ((path: string, text: string) => Promise<void>) | null;
  /** Reload the plugin catalog from storage. */
  refreshPlugins: (() => Promise<void>) | null;
  /** Runtime log lines, newest first. */
  pluginLogs: (() => string[]) | null;
}

export const testApi: TypbaseTestApi = {
  store: null,
  view: null,
  fileId: null,
  pageId: null,
  openPage: null,
  setMode: null,
  mode: null,
  engineStatus: null,
  engineMemory: null,
  crashEngine: null,
  openChat: null,
  openGraph: null,
  graphStats: null,
  backlinksFor: null,
  newChat: null,
  sendChat: null,
  chatMessages: null,
  setAiStub: null,
  openPlugin: null,
  installPlugin: null,
  pluginStatus: null,
  pluginHtml: null,
  pluginAction: null,
  pluginWindowOpen: null,
  pluginState: null,
  writeWorkspaceFile: null,
  refreshPlugins: null,
  pluginLogs: null,
};

if (import.meta.dev && typeof window !== "undefined") {
  (window as unknown as { __typbase: TypbaseTestApi }).__typbase = testApi;
}
