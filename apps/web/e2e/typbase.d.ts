/**
 * The dev-only `window.__typbase` handle as the e2e suite sees it. Kept in one
 * file so `app.test.ts` and `plugins.test.ts` cannot declare conflicting
 * shapes. `apps/web/src/lib/testApi.ts` is the runtime counterpart.
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
  getPage(id: string): { id: string; title: string; path: string } | undefined;
  getPluginInstance(id: string): { id: string; title: string } | undefined;
  getPluginInstall(pluginId: string): { id: string; version: string } | undefined;
  getChat(id: string): { id: string; pageId: string | null } | undefined;
  flush(): Promise<void>;
  createDailyNote(date: string): Promise<{ id: string; title: string }>;
  updatePageKind(id: string, kind: "document" | "notebook"): Promise<void>;
  deletePage(id: string): Promise<void>;
  updateSettings(patch: Record<string, unknown>): void;
  getSettings(): {
    name?: string;
    notebook?: { showCounters?: boolean };
    [key: string]: unknown;
  };
  setPageText(id: string, text: string): Promise<void>;
  getAiSettings(): Record<string, unknown>;
  listPages(): Array<{ id: string; title: string; path: string; order?: number }>;
  listCategories(): Array<{ id: string; name: string }>;
  addCategory(name: string): Promise<{ id: string; name: string }>;
  reorderPages(ids: string[]): void;
  reorderCategories(ids: string[]): void;
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
      chatMessages(
        threadId: string,
      ): Promise<Array<{ id: string; status: string; role: string; error: string | null }>>;
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
      /** Build a page export bundle and return its readable files. */
      exportPage(
        pageId: string,
        options?: Record<string, unknown>,
      ): Promise<{ base: string; files: Array<{ name: string; text: string }> }>;
      /** Compile a bundle's entry against only the bundle's own files. */
      compileBundle(
        files: Array<{ name: string; text: string }>,
        entry: string,
      ): Promise<{ errors: string[]; missing: string[]; foundEntry: boolean }>;
      refreshPlugins(): Promise<void>;
      pluginLogs(): string[];
    };
  }
}

export {};
