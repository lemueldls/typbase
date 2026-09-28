import type { TypstRequest } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { ThemePaletteTokens } from "@typbase/typing";

import { isWasmTrap } from "~/lib/typstRecovery";
import { resolveRequestPayloads, type RequestPayload } from "~/lib/typstRequests";
import { wasmBinaryUrl } from "~/lib/wasmUrl";

/**
 * Dynamic-link resolver client. One warm worker owns a `TypstState` and
 * compiles pages on demand: the link index asks for a page, the worker renders
 * it and returns the `typbase://page/` targets its links point at. Compiles
 * are serialized so one page at a time keeps the wasm heap steady, and a
 * trapped worker is dropped so the next request starts clean.
 */

export interface LinkWorkerStyle {
  font: string;
  mathFont: string | null;
  codeFont: string | null;
  textSize: number;
  palette: ThemePaletteTokens;
}

export interface LinkWorkerRequest {
  id: number;
  type: "resolve";
  pageId: string;
  source: string;
  prelude: string;
  spaceId: string;
  style?: LinkWorkerStyle;
}

export interface LinkWorkerResponse {
  id: number;
  type: "configure" | "request" | "insert" | "answer" | "result" | "purge";
  wasmUrl?: string;
  style?: LinkWorkerStyle;
  requests?: TypstRequest[];
  payload?: RequestPayload;
  inserted?: number;
  ok?: boolean;
  targets?: string[];
  error?: string;
}

const RESOLVE_TIMEOUT_MS = 30_000;

let worker: Worker | undefined;
let nextId = 1;
let store: WorkspaceStore | undefined;
let style: LinkWorkerStyle | undefined;
let styleKey = "";
let queue: Promise<unknown> = Promise.resolve();

interface Pending {
  resolve: (targets: string[]) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, Pending>();
/** The page each in-flight job is compiling, for self-embed stubbing. */
const jobPages = new Map<number, string>();

/** The workspace store that answers `#typbase.query` and embed requests. */
export function setLinkResolverStore(next: WorkspaceStore | undefined): void {
  store = next;
}

export function setLinkWorkerStyle(next: LinkWorkerStyle): void {
  const key = JSON.stringify(next);
  if (key === styleKey) return;

  styleKey = key;
  style = next;
  worker?.postMessage({
    id: 0,
    type: "configure",
    wasmUrl: wasmBinaryUrl,
    style: next,
  } satisfies LinkWorkerResponse);
}

/**
 * Drops the worker's cached query files. Page and category changes move what
 * a query loop returns, so the next resolution must not read stale JSON.
 */
export function purgeLinkResolver(): void {
  worker?.postMessage({ id: 0, type: "purge" } satisfies LinkWorkerResponse);
}

/** Rejects everything in flight and drops the worker so the next request
 *  starts from a fresh wasm instance. */
export function stopLinkResolver(reason: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(reason);
  }
  pending.clear();
  jobPages.clear();
  worker?.terminate();
  worker = undefined;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/links.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.postMessage({
    id: 0,
    type: "configure",
    wasmUrl: wasmBinaryUrl,
    ...(style ? { style } : {}),
  } satisfies LinkWorkerResponse);

  worker.addEventListener("message", (event: MessageEvent<LinkWorkerResponse>) => {
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
    jobPages.delete(message.id);
    if (message.ok) {
      entry.resolve(message.targets ?? []);
    } else {
      const error = new Error(message.error ?? "Link resolution failed");
      entry.reject(error);
      if (isWasmTrap(error)) {
        console.warn("[links] worker engine trapped, restarting:", error.message);
        stopLinkResolver(error);
      }
    }
  });

  worker.addEventListener("error", (event) => {
    const detail = event.message || event.filename || "unknown error";
    console.error("[links] worker error:", event.error ?? detail);
    stopLinkResolver(event.error ?? new Error(`Link resolver crashed: ${detail}`));
  });
  worker.addEventListener("messageerror", () => {
    stopLinkResolver(new Error("Link resolver message failed"));
  });

  return worker;
}

async function answerRequests(id: number, requests: TypstRequest[]): Promise<void> {
  const instance = worker;
  if (!instance || !store) return;

  let inserted = 0;
  try {
    const payloads = await resolveRequestPayloads(requests, store, jobPages.get(id) ?? null);
    for (const payload of payloads) {
      instance.postMessage({ id, type: "insert", payload } satisfies LinkWorkerResponse);
    }
    inserted = payloads.length;
  } catch (cause) {
    console.error("[links] resolving requests failed:", cause);
  }

  // Always answer: the worker's loop waits on this.
  instance.postMessage({ id, type: "answer", ok: true, inserted } satisfies LinkWorkerResponse);
}

function post(input: {
  pageId: string;
  source: string;
  prelude: string;
  spaceId: string;
}): Promise<string[]> {
  const instance = ensureWorker();
  const id = nextId++;

  return new Promise<string[]>((resolve, reject) => {
    const entry: Pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending.delete(id);
        jobPages.delete(id);
        stopLinkResolver(new Error("Link resolution timed out; the worker was restarted."));
      }, RESOLVE_TIMEOUT_MS),
    };
    pending.set(id, entry);
    jobPages.set(id, input.pageId);
    instance.postMessage({
      id,
      type: "resolve",
      ...input,
      ...(style ? { style } : {}),
    } satisfies LinkWorkerRequest);
  });
}

/**
 * Resolves one page's dynamic link calls to page ids. Jobs run one at a time
 * in call order. The caller is responsible for only asking for pages a
 * surface still wants.
 */
export function resolvePageLinks(input: {
  pageId: string;
  source: string;
  prelude: string;
  spaceId: string;
}): Promise<string[]> {
  const run = queue.then(() => post(input));
  queue = run.catch(() => undefined);

  return run;
}
