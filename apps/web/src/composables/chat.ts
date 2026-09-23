import type { ChatMessage, ChatThread, ThemePaletteTokens } from "@typbase/typing";

import { useSearch } from "~/composables/search";
import { resolveAppTheme } from "~/composables/theme";
import { useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import {
  activeThreads,
  configureChat,
  messageToolRuns,
  onChatEvent,
  renderedError,
  renderedMessage,
  repairMessage,
  resetChat,
  resolveProviderSettings,
  sendChat,
  stopChat,
  type ChatEngineDeps,
} from "~/lib/ai/engine";
import {
  checkChatMessage,
  renderChatMessage,
  setChatRequestStore,
  setChatWorkerStyle,
} from "~/lib/chatWorker";
import { sanitizeHtml } from "~/lib/plugins/sanitize";
import { publishPrelude } from "~/lib/publishPrelude";

/**
 * Vue binding for the chat runtime. The engine itself is framework-free; this
 * composable supplies the workspace store, the main-thread engine (for the
 * dialect card), the search index (for grounding), and the chat worker
 * (progressive render + acceptance check).
 */

export interface ChatSeed {
  threadId: string;
  pageId: string | null;
  selection: string | null;
}

interface ChatNavigation {
  openChat: (threadId: string) => void;
  openPage: (pageId: string) => void;
}

const navigation: ChatNavigation = { openChat: () => {}, openPage: () => {} };

/** The shell registers how the chat reaches app navigation. */
export function setChatNavigation(hooks: Partial<ChatNavigation>): void {
  Object.assign(navigation, hooks);
}

let pendingSeed: ChatSeed | null = null;

/** A selection the composer should pick up when the pane mounts. */
export function takeChatSeed(): ChatSeed | null {
  const seed = pendingSeed;
  pendingSeed = null;

  return seed;
}

function useChatState() {
  const { workspace, dataRevision } = useWorkspace();
  const { search, ensure } = useSearch();

  /** Bumped whenever the engine reports progress. */
  const chatRevision = ref(0);
  let styleKey = "";

  onChatEvent(() => {
    chatRevision.value += 1;
  });

  function currentStore() {
    const store = workspace.value;
    if (!store) throw new Error("No workspace is open");

    return store;
  }

  /** Settings-derived worker style; only pushed when it changes. */
  function applyWorkerStyle(
    store: ReturnType<typeof currentStore>,
    palette?: ThemePaletteTokens,
  ): void {
    const settings = store.getSettings();
    const style = {
      font: settings.font,
      mathFont: settings.mathFont,
      codeFont: settings.codeFont,
      textSize: settings.textSize,
      palette: palette ?? resolveAppTheme(settings).palette,
    };
    const key = JSON.stringify(style);
    if (key === styleKey) return;

    styleKey = key;
    setChatWorkerStyle(style);
  }

  function installDeps(store: ReturnType<typeof currentStore>): void {
    const deps: ChatEngineDeps = {
      store,
      typst: () => useTypst(),
      prelude: async () =>
        publishPrelude(currentStore().getSettings(), {
          theme: "workspace",
          paged: false,
        }),
      palette: () => resolveAppTheme(currentStore().getSettings()).palette,
      render: async ({ source, prelude, palette, spaceId }) => {
        applyWorkerStyle(currentStore(), palette);
        const result = await renderChatMessage({ source, prelude, spaceId });

        return { html: result.html ?? "", diagnostics: result.diagnostics };
      },
      check: async ({ source, prelude, spaceId }) => {
        const result = await checkChatMessage({ source, prelude, spaceId });

        return { diagnostics: result.diagnostics };
      },
    };

    // Search is optional and only used once the palette or chat started it.
    const manager = search.value;
    if (manager) {
      deps.search = async (query: string) => {
        const hits = await manager.query(query, 8);

        return hits.map((hit) => ({
          pageId: hit.docId,
          title: hit.title,
          text: hit.snippet.map((segment) => segment.text).join(""),
        }));
      };
    }

    configureChat(deps);
    setChatRequestStore(store);
  }

  /**
   * Sanitized render for a message. The engine's HTML never reaches `v-html`
   * raw: Typst can emit arbitrary elements, so the plugin allowlist runs here
   * too. Results are memoized per message revision.
   */
  const sanitized = new Map<string, { raw: string; html: string }>();
  function renderedHtml(messageId: string): string | undefined {
    void chatRevision.value;
    const raw = renderedMessage(messageId);
    if (!raw) return undefined;

    const cached = sanitized.get(messageId);
    if (cached?.raw === raw) return cached.html;

    const result = sanitizeHtml(raw).html;
    sanitized.set(messageId, { raw, html: result });

    return result;
  }

  watch(
    workspace,
    (store) => {
      if (!store) return;
      resetChat();
      sanitized.clear();
      installDeps(store);
    },
    { immediate: true },
  );

  // A started search index becomes available to the grounding layer.
  watch(search, (manager) => {
    if (!manager || !workspace.value) return;
    installDeps(workspace.value);
    void ensure(workspace.value).catch(() => {
      // Search is best-effort; chat works without it.
    });
  });

  const threads = computed<ChatThread[]>(() => {
    void dataRevision.value;
    void chatRevision.value;

    return workspace.value?.listChats() ?? [];
  });

  function thread(id: string): ChatThread | undefined {
    return workspace.value?.getChat(id);
  }

  async function startThread(
    input: {
      title?: string;
      pageId?: string | null;
      providerId?: string | null;
      model?: string | null;
    } = {},
  ): Promise<ChatThread> {
    const store = currentStore();
    const settings = store.getAiSettings();
    const provider = settings.providers.find((entry) => entry.id === settings.defaultProviderId);

    return store.createChat({
      title: input.title,
      pageId: input.pageId ?? null,
      providerId: input.providerId ?? provider?.id ?? null,
      model: input.model ?? null,
    });
  }

  /** Opens a new thread seeded with the current page and/or selection. */
  async function seedChat(input: {
    pageId?: string | null;
    selection?: string | null;
    prompt?: string;
  }): Promise<ChatThread> {
    const created = await startThread({ pageId: input.pageId ?? null });
    pendingSeed = {
      threadId: created.id,
      pageId: input.pageId ?? null,
      selection: input.selection ?? null,
    };
    navigation.openChat(created.id);

    return created;
  }

  async function deleteThread(id: string): Promise<void> {
    stopChat(id);
    await workspace.value?.deleteChat(id);
  }

  async function readMessages(threadId: string): Promise<ChatMessage[]> {
    return (await workspace.value?.readChatMessages(threadId)) ?? [];
  }

  function send(
    threadId: string,
    text: string,
    options: { pageId?: string | null; selection?: string | null } = {},
  ): Promise<void> {
    return sendChat({ threadId, text, ...options });
  }

  return {
    threads,
    thread,
    chatRevision,
    startThread,
    seedChat,
    deleteThread,
    readMessages,
    send,
    stop: stopChat,
    repair: repairMessage,
    isStreaming: (threadId: string) => {
      void chatRevision.value;

      return activeThreads().includes(threadId);
    },
    rendered: (messageId: string) => {
      void chatRevision.value;

      return renderedHtml(messageId);
    },
    renderedError: (messageId: string) => {
      void chatRevision.value;

      return renderedError(messageId);
    },
    tools: (messageId: string) => {
      void chatRevision.value;

      return messageToolRuns(messageId);
    },
    providers: computed(() => {
      void dataRevision.value;

      return workspace.value?.getAiSettings().providers ?? [];
    }),
    defaultProvider: computed(() => {
      void dataRevision.value;
      const settings = workspace.value?.getAiSettings();
      if (!settings) return null;

      try {
        return resolveProviderSettings(settings);
      } catch {
        return null;
      }
    }),
  };
}

export const useChat = createSharedComposable(useChatState);
