import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type {
  AiProviderSettings,
  AiSettings,
  ChatDiagnostic,
  ChatMessage,
  ChatToolRun,
  ThemePaletteTokens,
} from "@typbase/typing";

import { createId } from "@typbase/storage";

import { buildContext, type ContextDeps, type SearchHitLike } from "./context";
import { getAiKey } from "./keys";
import {
  createProvider,
  type AiProvider,
  type ProviderMessage,
  type ProviderToolCall,
} from "./providers";
import { WORKSPACE_TOOLS, runWorkspaceTool, type ToolContext } from "./tools";
import { buildRepairPrompt, hasErrors, toChatDiagnostics, summarizeDiagnostics } from "./verify";

/**
 * The chat runtime. It owns the loop that makes a model reply trustworthy:
 * stream tokens into a message, give the model read-only tools for grounding,
 * compile the finished source with the engine, and run bounded repair turns
 * until the pristine compile is clean.
 *
 * Rendering and verification happen in the chat worker; this module only
 * orchestrates. The Vue layer subscribes for updates and reads rendered HTML
 * out of the map below.
 */

export interface ChatEngineDeps {
  store: WorkspaceStore;
  /** The main-thread engine, for the dialect card source. */
  typst: () => Promise<TypstState>;
  /** Optional semantic/full-text search for grounding and the search tool. */
  search?: (query: string) => Promise<SearchHitLike[]>;
  /** Progressive render through the chat worker. */
  render: (input: {
    source: string;
    prelude: string;
    palette: ThemePaletteTokens;
    spaceId: string;
  }) => Promise<{ html: string; diagnostics: unknown[] }>;
  /** Pristine diagnostics-only compile through the chat worker. */
  check: (input: {
    source: string;
    prelude: string;
    palette: ThemePaletteTokens;
    spaceId: string;
  }) => Promise<{ diagnostics: unknown[] }>;
  /** The workspace's HTML prelude (style + user prelude). */
  prelude: () => Promise<string>;
  palette: () => ThemePaletteTokens;
  /** Dev/e2e hook: replaces whichever provider the settings resolve to. */
  providerOverride?: AiProvider | null;
}

export interface AssistantTurnResult {
  text: string;
  tools: ChatToolRun[];
}

export interface VerifyResult {
  diagnostics: ChatDiagnostic[];
  verified: boolean;
}

const MAX_TOOL_ROUNDS = 4;
const FLUSH_MS = 140;
const RENDER_DEBOUNCE_MS = 260;
const TOOL_TIMEOUT_MS = 15_000;

let deps: ChatEngineDeps | null = null;
/** Test hook: replaces the resolved provider without touching settings. */
let providerOverride: AiProvider | null = null;
const rendered = new Map<string, string>();
const renderedErrors = new Map<string, string>();
const listeners = new Set<() => void>();
const active = new Map<string, { controller: AbortController; messageId: string }>();
const toolRuns = new Map<string, ChatToolRun[]>();

export function configureChat(next: ChatEngineDeps): void {
  deps = next;
}

/** Dev/e2e hook: stream from this provider instead of the configured one. */
export function setProviderOverride(provider: AiProvider | null): void {
  providerOverride = provider;
}

export function chatConfigured(): boolean {
  return deps !== null;
}

/** Aborts every stream; call on workspace switch or teardown. */
export function resetChat(): void {
  for (const entry of active.values()) entry.controller.abort();
  active.clear();
  rendered.clear();
  renderedErrors.clear();
  toolRuns.clear();
  notify();
}

export function onChatEvent(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function requireDeps(): ChatEngineDeps {
  if (!deps) throw new Error("Chat is not configured yet");

  return deps;
}

export function isChatStreaming(threadId: string): boolean {
  return active.has(threadId);
}

export function renderedMessage(messageId: string): string | undefined {
  return rendered.get(messageId);
}

export function renderedError(messageId: string): string | undefined {
  return renderedErrors.get(messageId);
}

export function messageToolRuns(messageId: string): ChatToolRun[] {
  return toolRuns.get(messageId) ?? [];
}

/** The newest verified assistant message in a thread. */
export async function latestVerified(threadId: string): Promise<ChatMessage | undefined> {
  const messages = await requireDeps().store.readChatMessages(threadId);

  return [...messages].reverse().find((message) => message.status === "verified");
}

export function resolveProviderSettings(
  settings: AiSettings,
  requestedId?: string | null,
): AiProviderSettings {
  const wanted = requestedId ?? settings.defaultProviderId;
  const found =
    settings.providers.find((provider) => provider.id === wanted) ?? settings.providers[0];
  if (!found) throw new Error("No AI provider is configured. Add one in Settings.");

  return found;
}

function resolveProvider(
  settings: AiSettings,
  requestedId?: string | null,
): { config: AiProviderSettings; provider: AiProvider } {
  const config = resolveProviderSettings(settings, requestedId);
  const engine = deps;
  const provider =
    providerOverride ?? engine?.providerOverride ?? createProvider(config, getAiKey(config.id));

  return { config, provider };
}

function stopReasonText(): string {
  return "Stopped.";
}

/**
 * Streams one assistant turn, including tool rounds. Text accumulates across
 * rounds; each tool round appends the model's tool call and its result to the
 * provider conversation.
 */
export async function runAssistantTurn(input: {
  messages: ProviderMessage[];
  provider: AiProvider;
  model: string;
  signal: AbortSignal;
  tools: boolean;
  store: WorkspaceStore;
  search?: (query: string) => Promise<SearchHitLike[]>;
  onDelta?: (text: string) => void;
  onToolRun?: (run: ChatToolRun) => void;
}): Promise<AssistantTurnResult> {
  const messages = [...input.messages];
  const collected: ChatToolRun[] = [];
  let full = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const calls: ProviderToolCall[] = [];
    let roundText = "";

    const stream = input.provider.stream({
      messages,
      model: input.model,
      signal: input.signal,
      ...(input.tools ? { tools: WORKSPACE_TOOLS } : {}),
    });

    for await (const event of stream) {
      if (event.type === "text") {
        roundText += event.text;
        full += event.text;
        input.onDelta?.(event.text);
      } else if (event.type === "tool") {
        calls.push(event.call);
      }
    }

    if (input.signal.aborted) break;
    if (!calls.length) break;
    if (round === MAX_TOOL_ROUNDS) break;

    messages.push({ role: "assistant", content: roundText, toolCalls: calls });

    for (const call of calls) {
      const started = Date.now();
      const output = await withTimeout(
        runWorkspaceTool(call.name, call.input, {
          store: input.store,
          search: input.search,
        } satisfies ToolContext),
        TOOL_TIMEOUT_MS,
      );
      const run: ChatToolRun = {
        id: call.id,
        name: call.name,
        input: JSON.stringify(call.input ?? {}).slice(0, 2_000),
        output: output.slice(0, 2_000),
        at: started,
      };
      collected.push(run);
      input.onToolRun?.(run);
      messages.push({
        role: "tool",
        content: output,
        toolCallId: call.id,
        name: call.name,
      });
    }
  }

  return { text: full, tools: collected };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tool timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface TurnContext {
  threadId: string;
  message: ChatMessage;
  settings: AiSettings;
  prelude: string;
  palette: ThemePaletteTokens;
  store: WorkspaceStore;
  typstState: TypstState;
  provider: AiProvider;
  config: AiProviderSettings;
  model: string;
  controller: AbortController;
}

/**
 * Streams a reply into an existing assistant message: debounced source flushes
 * and progressive renders, tool rows, then verification and repair.
 */
async function runReplyTurn(
  context: TurnContext,
  messages: ProviderMessage[],
  search: ((query: string) => Promise<SearchHitLike[]>) | undefined,
): Promise<void> {
  const { store, message, threadId } = context;
  let source = message.source;
  let pendingSource = source;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (final = false): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (final || pendingSource !== source) {
      source = pendingSource;
      await store.updateChatMessage(threadId, message.id, { source });
    }
    notify();
  };

  const scheduleRender = (): void => {
    if (!context.settings.liveRender || context.controller.signal.aborted) return;
    if (renderTimer) return;

    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      void renderProgress(context, source).catch(() => {
        // Progressive render is best-effort; the final verify always runs.
      });
    }, RENDER_DEBOUNCE_MS);
  };

  const onDelta = (text: string): void => {
    pendingSource += text;
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flush().then(scheduleRender);
      }, FLUSH_MS);
    }
  };

  const result = await runAssistantTurn({
    messages,
    provider: context.provider,
    model: context.model,
    signal: context.controller.signal,
    tools: context.settings.tools,
    store,
    search,
    onDelta,
    onToolRun: (run) => {
      const runs = [...(toolRuns.get(message.id) ?? []), run];
      toolRuns.set(message.id, runs);
      void store.updateChatMessage(threadId, message.id, { tools: runs });
      notify();
    },
  });

  pendingSource = result.text;
  await flush(true);

  if (context.controller.signal.aborted) {
    await store.updateChatMessage(threadId, message.id, {
      status: "aborted",
      error: stopReasonText(),
    });
    notify();

    return;
  }

  await verifyAndRepair(context, source, result.tools);
}

/** Progressive render of the accumulated source into the message bubble. */
async function renderProgress(context: TurnContext, source: string): Promise<void> {
  const { store, message } = context;
  if (!source.trim()) return;

  try {
    const result = await requireDeps().render({
      source,
      prelude: context.prelude,
      palette: context.palette,
      spaceId: store.workspaceId,
    });
    if (result.html) {
      rendered.set(message.id, result.html);
      renderedErrors.delete(message.id);
      notify();
    }
  } catch (error) {
    renderedErrors.set(message.id, error instanceof Error ? error.message : String(error));
    notify();
  }
}

/**
 * The acceptance gate. A clean pristine compile marks the message verified;
 * otherwise the repair budget is spent on visible repair turns.
 */
async function verifyAndRepair(
  context: TurnContext,
  source: string,
  tools: ChatToolRun[],
): Promise<void> {
  const { store, message, threadId } = context;
  await store.updateChatMessage(threadId, message.id, {
    status: "verifying",
    tools,
  });
  notify();

  let currentSource = source;
  let diagnostics = await checkSource(context, currentSource);

  if (!hasErrors(diagnostics)) {
    await store.updateChatMessage(threadId, message.id, {
      status: "verified",
      diagnostics: [],
      error: null,
    });
    // Final render from the verified source, not the last streaming tick.
    await renderProgress(context, currentSource);
    notify();

    return;
  }

  await store.updateChatMessage(threadId, message.id, {
    status: "unverified",
    diagnostics,
    error: summarizeDiagnostics(diagnostics),
  });
  notify();

  let repairSource = message;
  for (let attempt = 0; attempt < context.settings.repairAttempts; attempt++) {
    if (context.controller.signal.aborted) return;

    const repair: ChatMessage = {
      id: createId(),
      role: "assistant",
      seq: 0,
      source: "",
      status: "streaming",
      providerId: context.config.id,
      model: context.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repairOf: repairSource.id,
      diagnostics: [],
      tools: [],
      error: null,
    };
    // Sequence numbers come from the store's view of the thread.
    const existing = await store.readChatMessages(threadId);
    repair.seq = (existing.at(-1)?.seq ?? 0) + 1;
    await store.appendChatMessage(threadId, repair);
    await store.updateChatMessage(threadId, message.id, { status: "repairing" });
    notify();

    const messages = buildRepairPrompt({
      typstState: context.typstState,
      source: currentSource,
      diagnostics,
    });

    let repaired = "";
    const onDelta = (text: string) => {
      repaired += text;
    };

    try {
      await runAssistantTurn({
        messages,
        provider: context.provider,
        model: context.model,
        signal: context.controller.signal,
        tools: false,
        store,
        onDelta,
      });
    } catch (error) {
      await store.updateChatMessage(threadId, repair.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      repairSource = repair;
      continue;
    }

    if (context.controller.signal.aborted) {
      await store.updateChatMessage(threadId, repair.id, { status: "aborted" });
      return;
    }

    await store.updateChatMessage(threadId, repair.id, { source: repaired });
    diagnostics = await checkSource(context, repaired);

    if (!hasErrors(diagnostics)) {
      await store.updateChatMessage(threadId, repair.id, {
        status: "verified",
        diagnostics: [],
        repairOf: repair.repairOf,
      });
      // The original stays unverified: the repair row is the fix, and the
      // chain is visible in the thread.
      await store.updateChatMessage(threadId, message.id, { status: "unverified" });
      await renderProgress({ ...context, message: repair }, repaired);
      notify();

      return;
    }

    await store.updateChatMessage(threadId, repair.id, {
      status: "unverified",
      diagnostics,
      error: summarizeDiagnostics(diagnostics),
    });
    currentSource = repaired;
    repairSource = repair;
    notify();
  }

  await store.updateChatMessage(threadId, message.id, { status: "unverified" });
  notify();
}

async function checkSource(context: TurnContext, source: string): Promise<ChatDiagnostic[]> {
  const result = await requireDeps().check({
    source,
    prelude: context.prelude,
    palette: context.palette,
    spaceId: context.store.workspaceId,
  });

  return toChatDiagnostics(result.diagnostics, source);
}

async function buildHistory(store: WorkspaceStore, threadId: string): Promise<ProviderMessage[]> {
  const messages = await store.readChatMessages(threadId);
  const history: ProviderMessage[] = [];

  // The system/context messages are added by the caller before these.
  for (const message of messages.slice(-16)) {
    if (!message.source.trim()) continue;
    history.push({
      role: message.role,
      content:
        message.role === "assistant"
          ? message.source
          : message.source.length > 8_000
            ? `${message.source.slice(0, 8_000)}\n… [truncated]`
            : message.source,
    });
  }

  return history;
}

export interface SendChatInput {
  threadId: string;
  text: string;
  providerId?: string | null;
  model?: string | null;
  pageId?: string | null;
  selection?: string | null;
}

/** Sends a user message and runs the assistant reply to completion. */
export async function sendChat(input: SendChatInput): Promise<void> {
  const engine = requireDeps();
  const store = engine.store;
  const settings = store.getAiSettings();
  if (!settings.enabled) throw new Error("AI is disabled in Settings.");

  const thread = store.getChat(input.threadId);
  if (!thread) throw new Error("This chat thread no longer exists.");
  if (active.has(input.threadId)) throw new Error("A reply is already streaming.");
  if (!input.text.trim()) return;

  const { config, provider } = resolveProvider(settings, input.providerId ?? thread.providerId);
  const model = input.model ?? thread.model ?? config.model;
  const typstState = await engine.typst();
  const search = engine.search;
  const prelude = await engine.prelude();
  const palette = engine.palette();

  const context = await buildContext({ store, typstState, search } satisfies ContextDeps, {
    prompt: input.text,
    pageId: input.pageId ?? thread.pageId,
    selection: input.selection ?? null,
    includePage: settings.pageContext,
    // Tools do their own retrieval; the prefetch is for models that answer
    // straight away, so only add it when there is no tool loop.
    includeSearch: !settings.tools || settings.pageContext,
  });

  const userMessage: ChatMessage = {
    id: createId(),
    role: "user",
    seq: 0,
    source: input.text,
    status: "verified",
    providerId: null,
    model: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    repairOf: null,
    diagnostics: [],
    tools: [],
    error: null,
  };
  const existing = await store.readChatMessages(input.threadId);
  userMessage.seq = (existing.at(-1)?.seq ?? 0) + 1;

  const assistant: ChatMessage = {
    id: createId(),
    role: "assistant",
    seq: userMessage.seq + 1,
    source: "",
    status: "streaming",
    providerId: config.id,
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    repairOf: null,
    diagnostics: [],
    tools: [],
    error: null,
  };

  await store.appendChatMessage(input.threadId, userMessage);
  if (thread.title === "New chat") {
    store.updateChat(input.threadId, {
      title: input.text.trim().split("\n")[0]!.slice(0, 80),
      pageId: input.pageId ?? thread.pageId,
    });
  }
  await store.appendChatMessage(input.threadId, assistant);

  const messages: ProviderMessage[] = [
    { role: "system", content: context.system },
    ...(await buildHistory(store, input.threadId)),
  ];

  const controller = new AbortController();
  active.set(input.threadId, { controller, messageId: assistant.id });
  notify();

  try {
    await runReplyTurn(
      {
        threadId: input.threadId,
        message: assistant,
        settings,
        prelude,
        palette,
        store,
        typstState,
        provider,
        config,
        model,
        controller,
      },
      messages,
      search,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await store.updateChatMessage(input.threadId, assistant.id, {
      status: controller.signal.aborted ? "aborted" : "error",
      error: text,
    });
  } finally {
    active.delete(input.threadId);
    notify();
  }
}

/** Stops the in-flight reply for a thread, keeping the partial source. */
export function stopChat(threadId: string): void {
  active.get(threadId)?.controller.abort();
}

/**
 * Re-runs the acceptance gate on a message and repairs it if needed. Used by
 * the "Repair" action on an unverified reply.
 */
export async function repairMessage(threadId: string, messageId: string): Promise<void> {
  const engine = requireDeps();
  const store = engine.store;
  const settings = store.getAiSettings();
  const message = (await store.readChatMessages(threadId)).find(
    (candidate) => candidate.id === messageId,
  );
  if (!message || message.role !== "assistant") return;
  if (active.has(threadId)) throw new Error("A reply is already streaming.");

  const thread = store.getChat(threadId);
  if (!thread) return;
  const { config, provider } = resolveProvider(settings, message.providerId ?? thread.providerId);
  const model = message.model ?? thread.model ?? config.model;
  const typstState = await engine.typst();
  const controller = new AbortController();
  active.set(threadId, { controller, messageId });
  notify();

  try {
    await verifyAndRepair(
      {
        threadId,
        message,
        settings,
        prelude: await engine.prelude(),
        palette: engine.palette(),
        store,
        typstState,
        provider,
        config,
        model,
        controller,
      },
      message.source,
      message.tools,
    );
  } finally {
    active.delete(threadId);
    notify();
  }
}

/**
 * One-shot completion for plugins. `format: "typst"` runs the dialect card,
 * the acceptance gate, and the repair loop, and returns validated Typst.
 */
export async function completeForPlugin(input: {
  store: WorkspaceStore;
  prompt: string;
  format: "text" | "typst";
  pageId?: string | null;
  selection?: string | null;
  providerId?: string | null;
  model?: string | null;
  tools?: boolean;
  onDelta?: (text: string) => void;
  /** Called before a repair pass, so streaming callers can clear their buffer. */
  onReset?: () => void;
  signal?: AbortSignal;
}): Promise<{ text: string; diagnostics: ChatDiagnostic[] }> {
  const engine = requireDeps();
  const settings = input.store.getAiSettings();
  if (!settings.enabled) throw new Error("AI is disabled in Settings.");

  const { config, provider } = resolveProvider(settings, input.providerId);
  const model = input.model ?? config.model;
  const typstState = await engine.typst();
  const controller = new AbortController();
  const signal = input.signal ?? controller.signal;

  let system: string;
  if (input.format === "typst") {
    const context = await buildContext(
      { store: input.store, typstState, search: engine.search } satisfies ContextDeps,
      {
        prompt: input.prompt,
        pageId: input.pageId ?? null,
        selection: input.selection ?? null,
        includePage: settings.pageContext,
        includeSearch: settings.tools,
      },
    );
    system = context.system;
  } else {
    system =
      "You answer plugin requests for a local-first knowledge base. Follow the requested output format exactly; use plain text or JSON, never Typst unless asked.";
  }

  const messages: ProviderMessage[] = [
    { role: "system", content: system },
    { role: "user", content: input.prompt },
  ];

  const result = await runAssistantTurn({
    messages,
    provider,
    model,
    signal,
    tools: input.tools ?? settings.tools,
    store: input.store,
    search: engine.search,
    onDelta: input.onDelta,
  });

  if (input.format !== "typst") return { text: result.text, diagnostics: [] };

  let text = result.text;
  let diagnostics = toChatDiagnostics(
    (
      await engine.check({
        source: text,
        prelude: await engine.prelude(),
        palette: engine.palette(),
        spaceId: input.store.workspaceId,
      })
    ).diagnostics,
    text,
  );

  for (let attempt = 0; attempt < settings.repairAttempts && hasErrors(diagnostics); attempt++) {
    if (signal.aborted) break;
    input.onReset?.();
    const repaired = await runAssistantTurn({
      messages: buildRepairPrompt({ typstState, source: text, diagnostics }),
      provider,
      model,
      signal,
      tools: false,
      store: input.store,
      onDelta: input.onDelta,
    });
    text = repaired.text;
    diagnostics = toChatDiagnostics(
      (
        await engine.check({
          source: text,
          prelude: await engine.prelude(),
          palette: engine.palette(),
          spaceId: input.store.workspaceId,
        })
      ).diagnostics,
      text,
    );
  }

  return { text, diagnostics };
}

/** Active stream bookkeeping for the UI (stop buttons, spinners). */
export function activeThreads(): string[] {
  return [...active.keys()];
}
