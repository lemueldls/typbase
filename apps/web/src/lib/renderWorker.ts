import type { WorkspaceStore } from "@typbase/storage";
import type { ThemePaletteTokens } from "@typbase/typing";
import type { TypstRequest } from "@typbase/wasm";

import { resolveRequestPayloads, type RequestPayload } from "~/lib/typstRequests";
import { wasmBinaryUrl } from "~/lib/wasmUrl";

export interface RenderWorkerRequest {
  id: number;
  type: "render";
  pagePath: string;
  source: string;
  prelude: string;
  wants: "html" | "pdf" | "svg";
  /** SVG only: merge all pages into a single document. */
  merged?: boolean;
  spaceId: string;
  /** Export palette; the worker installs it so the code-block theme exists. */
  theme?: ThemePaletteTokens;
}

export interface RenderWorkerResponse {
  id: number;
  type: "configure" | "request" | "result" | "insert" | "answer";
  /** Configure: the wasm URL proven to work on the main thread. */
  wasmUrl?: string;
  requests?: TypstRequest[];
  payload?: RequestPayload;
  ok?: boolean;
  /** Payloads the main thread inserted for this pass, for the worker's loop. */
  inserted?: number;
  html?: string;
  pdf?: Uint8Array;
  svg?: string[];
  diagnostics?: unknown[];
  error?: string;
}

export interface RenderOutcome {
  html?: string;
  pdf?: Uint8Array;
  svg?: string[];
  diagnostics?: unknown[];
  /** Files the render needed, so a portable project can bundle them. */
  payloads: RequestPayload[];
}

/** A render can idle behind a slow compile; without a message for this long,
 *  assume the worker is wedged and restart it instead of hanging the UI. */
const RENDER_IDLE_TIMEOUT_MS = 30_000;

let worker: Worker | undefined;
let nextId = 1;
let requestStore: WorkspaceStore | undefined;
/** Renders share one worker and its request loop; run them one at a time so a
 *  concurrent publish and export cannot interleave request passes. */
let renderQueue: Promise<unknown> = Promise.resolve();

export function setPublishRequestStore(store: WorkspaceStore | undefined): void {
  requestStore = store;
}

interface PendingRender {
  resolve: (value: RenderOutcome) => void;
  reject: (reason: unknown) => void;
  payloads: RequestPayload[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingRender>();

function keepAlive(entry: PendingRender, id: number): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pending.delete(id);
    stopWorker(new Error("Render timed out; the worker was restarted."));
  }, RENDER_IDLE_TIMEOUT_MS);
}

/** Rejects everything in flight and drops the worker, so the next render gets
 *  a fresh instance instead of posting into a dead one. */
function stopWorker(reason: Error): void {
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

  worker = new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
    type: "module",
  });
  // The worker cannot re-derive the Vite wasm asset URL reliably (resolution
  // differs between worker contexts and bundlers), so it gets the URL the main
  // thread already loaded successfully.
  worker.postMessage({
    id: 0,
    type: "configure",
    wasmUrl: wasmBinaryUrl,
  } satisfies RenderWorkerResponse);

  worker.addEventListener("message", (event: MessageEvent<RenderWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (entry) keepAlive(entry, message.id);

    if (message.type === "request") {
      void answerRequests(message.id, message.requests ?? []);
      return;
    }
    if (message.type !== "result") return;

    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve({
        html: message.html,
        pdf: message.pdf,
        svg: message.svg,
        diagnostics: message.diagnostics,
        payloads: entry.payloads,
      });
    } else {
      entry.reject(new Error(message.error ?? "Render failed"));
    }
  });

  worker.addEventListener("error", (event) => {
    const detail = event.message || event.filename || "unknown error";
    console.error("[render] worker error:", event.error ?? detail);
    stopWorker(event.error ?? new Error(`Render worker crashed: ${detail}`));
  });
  worker.addEventListener("messageerror", () => {
    console.error("[render] worker message could not be deserialized");
    stopWorker(new Error("Render worker message failed"));
  });

  return worker;
}

async function answerRequests(id: number, requests: TypstRequest[]): Promise<void> {
  const instance = worker;
  if (!instance || !requestStore) return;

  let inserted = 0;
  try {
    const payloads = await resolveRequestPayloads(requests, requestStore, null);
    const entry = pending.get(id);
    for (const payload of payloads) {
      entry?.payloads.push(payload);
      instance.postMessage({ id, type: "insert", payload } satisfies RenderWorkerResponse);
    }
    inserted = payloads.length;
  } catch (cause) {
    console.error("[render] resolving requests failed:", cause);
  }

  // Always answer: the worker's loop waits on this, and a throw here would
  // leave it waiting forever.
  instance.postMessage({
    id,
    type: "answer",
    ok: true,
    inserted,
  } satisfies RenderWorkerResponse);
}

export function renderInWorker(input: {
  pagePath: string;
  source: string;
  prelude: string;
  wants: "html" | "pdf" | "svg";
  merged?: boolean;
  spaceId: string;
  theme?: ThemePaletteTokens;
}): Promise<RenderOutcome> {
  const run = renderQueue.then(() => renderOnce(input));
  renderQueue = run.catch(() => undefined);

  return run;
}

async function renderOnce(input: {
  pagePath: string;
  source: string;
  prelude: string;
  wants: "html" | "pdf" | "svg";
  merged?: boolean;
  spaceId: string;
  theme?: ThemePaletteTokens;
}): Promise<RenderOutcome> {
  const instance = ensureWorker();
  const id = nextId++;

  return new Promise<RenderOutcome>((resolve, reject) => {
    const entry: PendingRender = {
      resolve,
      reject,
      payloads: [],
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    pending.set(id, entry);
    keepAlive(entry, id);
    instance.postMessage({ id, type: "render", ...input } satisfies RenderWorkerRequest);
  });
}
