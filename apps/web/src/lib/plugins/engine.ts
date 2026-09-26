import { reactive } from "vue";

import { useTypst } from "~/composables/typst";
import { useEngineHealth } from "~/lib/engineHealth";
import { wasmBinaryUrl } from "~/lib/wasmUrl";

import type {
  PluginCompileRequest,
  PluginCompileResponse,
  PluginSurfaceInput,
  PluginSurfaceResult,
} from "./protocol";

import { compileSurface } from "./compile";

/**
 * Plugin compile client. The worker is the default so a plugin compile never
 * blocks the editor; when it cannot start (crash, module load failure) the
 * host falls back to the shared main-thread TypstState and keeps working.
 */

export interface PluginEngineState {
  mode: "worker" | "local";
  lastError: string | null;
  workerCrashes: number;
}

export const pluginEngine = reactive<PluginEngineState>({
  mode: "worker",
  lastError: null,
  workerCrashes: 0,
});

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: PluginSurfaceResult) => void; reject: (reason: unknown) => void }
>();

function rejectPending(message: string): void {
  for (const [, entry] of pending) entry.reject(new Error(message));
  pending.clear();
}

function announceCrash(message: string): void {
  pluginEngine.workerCrashes += 1;
  pluginEngine.lastError = message;
  rejectPending(message);
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL("../../workers/plugin.worker.ts", import.meta.url), {
    type: "module",
  });

  created.addEventListener("message", (event: MessageEvent<PluginCompileResponse>) => {
    const message = event.data;

    if (message.type === "crash") {
      announceCrash([message.message, message.stack].filter(Boolean).join("\n"));
      return;
    }

    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (!entry) return;

    if (message.ok) {
      entry.resolve({
        html: message.html,
        diagnostics: message.diagnostics,
        requests: message.requests,
      });
    } else {
      entry.reject(new Error(message.error));
    }
  });

  // Fires when a message cannot be deserialized (should not happen).
  created.addEventListener("messageerror", () => {
    announceCrash("plugin worker message could not be deserialized");
  });

  // Fires on uncaught worker errors and on module load failures.
  created.addEventListener("error", (event) => {
    const detail =
      event.error instanceof Error
        ? (event.error.stack ?? event.error.message)
        : event.message || "plugin worker error";
    const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";

    announceCrash(`${detail}${location}`);
    created.terminate();
    if (worker === created) worker = undefined;
  });

  worker = created;

  return created;
}

function compileInWorker(input: PluginSurfaceInput): Promise<PluginSurfaceResult> {
  const active = ensureWorker();
  const id = nextId++;
  const promise = new Promise<PluginSurfaceResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });

  active.postMessage({
    type: "compile",
    id,
    ...input,
    wasmUrl: wasmBinaryUrl,
  } satisfies PluginCompileRequest);

  return promise;
}

async function compileLocally(input: PluginSurfaceInput): Promise<PluginSurfaceResult> {
  if (useEngineHealth().value.status === "failed") {
    // The fallback compiles on the shared main-thread state, which traps
    // while failed. The caller shows this in the plugin's error list; the
    // engine toast already explains how to recover.
    throw new Error("The Typst engine stopped; retry it before loading plugin surfaces.");
  }

  const typstState = await useTypst();

  return compileSurface(typstState, input);
}

/** Retries the worker after the lab cleared the old failure. */
export function resetPluginEngine(): void {
  pluginEngine.mode = "worker";
  pluginEngine.lastError = null;
  worker?.terminate();
  worker = undefined;
  rejectPending("plugin engine reset");
}

export async function compilePluginSurface(
  input: PluginSurfaceInput,
): Promise<PluginSurfaceResult> {
  if (pluginEngine.mode === "worker") {
    try {
      const result = await compileInWorker(input);
      return { ...result, engine: "worker" };
    } catch (error) {
      pluginEngine.mode = "local";
      pluginEngine.lastError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[plugins] worker unavailable, compiling on the main thread: ${pluginEngine.lastError}`,
      );
      worker?.terminate();
      worker = undefined;
    }
  }

  const result = await compileLocally(input);

  return {
    ...result,
    engine: "local",
    fallbackReason: pluginEngine.lastError ?? undefined,
  };
}
