/**
 * The dev-only `window.__typbase` handle as the e2e suite sees it. Kept in one
 * file so `app.test.ts` and `plugins.test.ts` cannot declare conflicting
 * shapes; `apps/web/src/lib/testApi.ts` is the runtime counterpart.
 */

import type { EditorView } from "@codemirror/view";

interface StoreHandle {
  createPage(input: {
    title: string;
    content?: string;
    kind?: "document" | "notebook";
    categoryId?: string | null;
  }): Promise<{ id: string; title: string }>;
  loadPageText(id: string): Promise<string>;
  getPluginInstance(id: string): { id: string; title: string } | undefined;
  flush(): Promise<void>;
  updatePageKind(id: string, kind: "document" | "notebook"): Promise<void>;
  updateSettings(patch: Record<string, unknown>): void;
  getAiSettings(): Record<string, unknown>;
  readChatMessages(id: string): Promise<Array<{ id: string; status: string }>>;
  deleteChat(id: string): Promise<void>;
}

declare global {
  interface Window {
    __typbase: {
      pageId: string;
      store: StoreHandle;
      view: EditorView | null;
      openPage(id: string): void;
      setMode(mode: string): void;
      mode(): string;
      engineStatus(): string;
      engineMemory(): number;
      crashEngine(): void;
      openChat(threadId?: string | null): void;
      openGraph(): void;
      graphStats(): { nodes: number; edges: number } | null;
      backlinksFor(pageId: string): string[];
      newChat(pageId?: string | null): Promise<string>;
      sendChat(threadId: string, text: string): Promise<void>;
      chatMessages(threadId: string): Promise<Array<{ id: string; status: string }>>;
      setAiStub(provider: unknown): void;
      installPlugin(pluginId: string): Promise<string>;
      openPlugin(instanceId: string): void;
      pluginStatus(instanceId: string, kind: string): string | null;
      pluginHtml(instanceId: string, kind: string): string;
      pluginAction(
        instanceId: string,
        kind: string,
        name: string,
        args?: Record<string, unknown>,
        fields?: Record<string, unknown>,
      ): Promise<void>;
      pluginWindowOpen(instanceId: string): boolean;
      pluginState(instanceId: string): Promise<Record<string, unknown[]>>;
      writeWorkspaceFile(path: string, text: string): Promise<void>;
      refreshPlugins(): Promise<void>;
      pluginLogs(): string[];
    };
  }
}

export {};
