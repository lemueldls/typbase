import type { WorkspaceStore } from "@typbase/storage";
import type { TypstRequest } from "@typbase/wasm";

import { resolveRequestPayloads } from "~/lib/typstRequests";

/**
 * Publish render worker, main-thread side. Renders run in a worker so a big
 * publish never blocks the editor. The worker answers `#typbase.query` and
 * `#typbase.embed` by asking here; payloads go back as insert messages into
 * the worker's own wasm instance (not the editor's).
 */

export interface RenderWorkerRequest {
  id: number;
  type: "render";
  pagePath: string;
  source: string;
  prelude: string;
  wants: "html" | "pdf";
  fileId?: unknown;
  spaceId: string;
}

export interface RenderWorkerResponse {
  id: number;
  type: "request" | "result" | "insert" | "answer";
  requests?: TypstRequest[];
  payload?:
    | { type: "source"; path: string; text: string }
    | { type: "file"; path: string; bytes: Uint8Array };
  ok?: boolean;
  html?: string;
  pdf?: Uint8Array;
  diagnostics?: unknown[];
  error?: string;
}

interface RenderOutcome {
  html?: string;
  pdf?: Uint8Array;
  diagnostics?: unknown[];
}

let worker: Worker | undefined;
let nextId = 1;
let pending = new Map<
  number,
  { resolve: (value: RenderOutcome) => void; reject: (reason: unknown) => void }
>();
let requestStore: WorkspaceStore | undefined;

export function setPublishRequestStore(
  store: WorkspaceStore | undefined,
): void {
  requestStore = store;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.addEventListener(
    "message",
    (event: MessageEvent<RenderWorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);

      if (message.type === "request") {
        void answerRequests(message.id, message.requests ?? []);
      } else if (message.type === "insert") {
        if (!entry) return;

        // Not a real state; inserts are posted directly to the worker below.
      } else if (message.type === "result") {
        pending.delete(message.id);
        if (message.ok) {
          entry?.resolve({
            html: message.html,
            pdf: message.pdf,
            diagnostics: message.diagnostics,
          });
        } else {
          entry?.reject(new Error(message.error ?? "Render failed"));
        }
      }
    },
  );

  worker.addEventListener("error", (event) => {
    for (const [, entry] of pending)
      entry.reject(event.error ?? new Error("Worker crashed"));
    pending.clear();
  });

  return worker;
}

async function answerRequests(
  id: number,
  requests: TypstRequest[],
): Promise<void> {
  const w = worker;
  if (!w || !requestStore) return;

  const payloads = await resolveRequestPayloads(requests, requestStore, null);
  for (const payload of payloads) {
    w.postMessage({
      id,
      type: "insert",
      payload,
    } satisfies RenderWorkerResponse);
  }
  w.postMessage({
    id,
    type: "answer",
    ok: true,
  } satisfies RenderWorkerResponse);
}

export async function renderInWorker(input: {
  pagePath: string;
  source: string;
  prelude: string;
  wants: "html" | "pdf";
  spaceId: string;
}): Promise<RenderOutcome> {
  const w = ensureWorker();
  const id = nextId++;
  const promise = new Promise<RenderOutcome>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  w.postMessage({ id, type: "render", ...input } satisfies RenderWorkerRequest);

  return promise;
}
