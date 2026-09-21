import init, { takePanicGlobal, TypstState } from "@typbase/engine";
import mapleMonoBold from "~~/public/fonts/maple/MapleMono-Bold.ttf?url";
import mapleMonoBoldItalic from "~~/public/fonts/maple/MapleMono-BoldItalic.ttf?url";
import mapleMonoItalic from "~~/public/fonts/maple/MapleMono-Italic.ttf?url";
import mapleMono from "~~/public/fonts/maple/MapleMono-Regular.ttf?url";
import newcmMathBold from "~~/public/fonts/math/NewCMMath-Bold.otf?url";
import newcmMath from "~~/public/fonts/math/NewCMMath-Regular.otf?url";

import type { PluginCompileRequest, PluginCompileResponse } from "~/lib/plugins/protocol";

import { compileSurface } from "~/lib/plugins/compile";

/**
 * Worker entry: owns one TypstState for plugin surfaces. The host posts every
 * source and the JSON context with each request; compiles never touch the
 * editor's wasm instance. Crashes are reported back with a stack before the
 * worker dies, so the host can fall back and the plugin lab can show why.
 */

let state: TypstState | undefined;

async function ensureState(): Promise<TypstState> {
  if (state) return state;

  await init();
  const typstState = new TypstState();
  for (const url of [
    mapleMono,
    mapleMonoItalic,
    mapleMonoBold,
    mapleMonoBoldItalic,
    newcmMath,
    newcmMathBold,
  ]) {
    const response = await fetch(url);
    typstState.installFont(new Uint8Array(await response.arrayBuffer()));
  }
  state = typstState;

  return state;
}

function reportCrash(message: string, stack?: string): void {
  try {
    self.postMessage({ type: "crash", message, stack } satisfies PluginCompileResponse);
  } catch {
    // The worker is already gone; the host's error handler takes over.
  }
}

self.addEventListener("error", (event) => {
  reportCrash(
    event.message || "plugin worker error",
    event.error instanceof Error ? event.error.stack : undefined,
  );
});

self.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  reportCrash(
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined,
  );
});

self.addEventListener("message", (event: MessageEvent<PluginCompileRequest>) => {
  const message = event.data;
  if (message.type !== "compile") return;

  void (async () => {
    const id = message.id;

    try {
      const typstState = await ensureState();
      const result = compileSurface(typstState, message);

      self.postMessage({
        type: "result",
        id,
        ok: true,
        html: result.html,
        diagnostics: result.diagnostics,
        requests: result.requests,
      } satisfies PluginCompileResponse);
    } catch (error) {
      const panic = takePanicGlobal() ?? "";
      const reason = error instanceof Error ? error : new Error(String(error));

      self.postMessage({
        type: "result",
        id,
        ok: false,
        error: [reason.message, panic].filter(Boolean).join(" | "),
      } satisfies PluginCompileResponse);
    }
  })();
});
