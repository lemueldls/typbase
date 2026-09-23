import type { TypstRequest } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { ThemePaletteTokens } from "@typbase/typing";

import { pushToast } from "~/composables/toasts";
import { isWasmTrap } from "~/lib/typstRecovery";
import { resolveRequestPayloads, type RequestPayload } from "~/lib/typstRequests";
import { wasmBinaryUrl } from "~/lib/wasmUrl";

/**
 * Chat compile client. One warm worker owns a `TypstState`: the engine's
 * memoization makes recompiling a growing message cheap, which is what lets
 * the chat render on every debounce tick. Compiles are serialized and only
 * the newest one matters, so a stopped stream cannot stack work.
 */

export interface ChatWorkerStyle {
  font: string;
  mathFont: string | null;
  codeFont: string | null;
  textSize: number;
  palette: ThemePaletteTokens;
}

export interface ChatWorkerRequest {
  id: number;
  type: "compile";
  mode: "render" | "check";
  source: string;
  prelude: string;
  spaceId: string;
  style?: ChatWorkerStyle;
}

export interface ChatWorkerResponse {
  id: number;
  type: "configure" | "request" | "insert" | "answer" | "result";
  wasmUrl?: string;
  style?: ChatWorkerStyle;
  requests?: TypstRequest[];
  payload?: RequestPayload;
  inserted?: number;
  ok?: boolean;
  html?: string;
  diagnostics?: unknown[];
  error?: string;
}

export interface ChatCompileResult {
  html?: string;
  diagnostics: unknown[];
}

const COMPILE_TIMEOUT_MS = 30_000;

let worker: Worker | undefined;
let nextId = 1;
let store: WorkspaceStore | undefined;
let style: ChatWorkerStyle | undefined;
let queue: Promise<unknown> = Promise.resolve();

interface Pending {
  resolve: (value: ChatCompileResult) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, Pending>();

/** The workspace store that answers `#typbase.query` and embed requests. */
export function setChatRequestStore(next: WorkspaceStore | undefined): void {
  store = next;
}

export function setChatWorkerStyle(next: ChatWorkerStyle): void {
  style = next;
  worker?.postMessage({
    id: 0,
    type: "configure",
    wasmUrl: wasmBinaryUrl,
    style: next,
  } satisfies ChatWorkerResponse);
}

/** Rejects everything in flight and drops the worker so the next compile
 *  starts from a fresh wasm instance. */
export function stopChatWorker(reason: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(reason);
  }
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/chat.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.postMessage({
    id: 0,
    type: "configure",
    wasmUrl: wasmBinaryUrl,
    ...(style ? { style } : {}),
  } satisfies ChatWorkerResponse);

  worker.addEventListener("message", (event: MessageEvent<ChatWorkerResponse>) => {
    const message = event.data;

    if (message.type === "request") {
      void answerRequests(message.id, message.requests ?? []);
      return;
    }

    if (message.type !== "result") return;
    const entry = pending.get(message.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve({ html: message.html, diagnostics: message.diagnostics ?? [] });
    } else {
      const error = new Error(message.error ?? "Chat compile failed");
      entry.reject(error);
      if (isWasmTrap(error)) {
        console.warn("[chat] worker engine trapped, restarting:", error.message);
        pushToast({ titleKey: "engine.renderCrashed", duration: 6000 });
        stopChatWorker(error);
      }
    }
  });

  worker.addEventListener("error", (event) => {
    const detail = event.message || event.filename || "unknown error";
    console.error("[chat] worker error:", event.error ?? detail);
    stopChatWorker(event.error ?? new Error(`Chat worker crashed: ${detail}`));
  });
  worker.addEventListener("messageerror", () => {
    stopChatWorker(new Error("Chat worker message failed"));
  });

  return worker;
}

async function answerRequests(id: number, requests: TypstRequest[]): Promise<void> {
  const instance = worker;
  if (!instance || !store) return;

  let inserted = 0;
  try {
    const payloads = await resolveRequestPayloads(requests, store, null);
    for (const payload of payloads) {
      instance.postMessage({ id, type: "insert", payload } satisfies ChatWorkerResponse);
    }
    inserted = payloads.length;
  } catch (cause) {
    console.error("[chat] resolving requests failed:", cause);
  }

  // Always answer: the worker's loop waits on this.
  instance.postMessage({
    id,
    type: "answer",
    ok: true,
    inserted,
  } satisfies ChatWorkerResponse);
}

function post(mode: "render" | "check", source: string, prelude: string, spaceId: string) {
  const instance = ensureWorker();
  const id = nextId++;

  return new Promise<ChatCompileResult>((resolve, reject) => {
    const entry: Pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending.delete(id);
        stopChatWorker(new Error("Chat compile timed out; the worker was restarted."));
      }, COMPILE_TIMEOUT_MS),
    };
    pending.set(id, entry);
    instance.postMessage({
      id,
      type: "compile",
      mode,
      source,
      prelude,
      spaceId,
      ...(style ? { style } : {}),
    } satisfies ChatWorkerRequest);
  });
}

function enqueue(
  mode: "render" | "check",
  input: { source: string; prelude: string; spaceId: string },
): Promise<ChatCompileResult> {
  const run = queue.then(() => post(mode, input.source, input.prelude, input.spaceId));
  queue = run.catch(() => undefined);

  return run;
}

/** Progressive render: HTML plus whatever warnings the synth produced. */
export function renderChatMessage(input: {
  source: string;
  prelude: string;
  spaceId: string;
}): Promise<ChatCompileResult> {
  return enqueue("render", input);
}

/** Acceptance check: diagnostics from the pristine synth, no repair. */
export function checkChatMessage(input: {
  source: string;
  prelude: string;
  spaceId: string;
}): Promise<ChatCompileResult> {
  return enqueue("check", input);
}
