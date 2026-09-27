import type { TypstRequest, TypstState } from "@typbase/engine";

import type { LinkWorkerRequest, LinkWorkerResponse, LinkWorkerStyle } from "~/lib/linkResolver";

import { extractPageTargets } from "~/lib/links";
import { themeColorsFromPalette } from "~/lib/rendererPalette";

import { initTypstState, installPayload, payloadKey, requestKey } from "./typstWorkerCore";

/**
 * Worker entry for dynamic link resolution. One warm `TypstState` compiles
 * the pages the index asks for: the rendered HTML carries the anchors a query
 * loop produced, and `extractPageTargets` turns them into page ids. Requests
 * resolve through the main thread; a purge drops the cached query files when
 * workspace data moves.
 */

let wasmModuleUrl: string | undefined;
let state: TypstState | undefined;
let style: LinkWorkerStyle | undefined;
let styleKey = "";
/** Inserted payload paths, dropped when the main thread purges query data. */
const insertedPaths = new Set<string>();

async function ensureState(): Promise<TypstState> {
  if (state) return state;
  if (!wasmModuleUrl) throw new Error("Link worker was not configured with a wasm URL");

  state = await initTypstState(wasmModuleUrl);

  return state;
}

/** Fonts, theme, and text size live on a space context, so the page source
 *  must share that context or the settings never apply. */
function applyStyle(typstState: TypstState, next: LinkWorkerStyle, spaceId: string): void {
  const key = `${spaceId}:${JSON.stringify(next)}`;
  if (key === styleKey) return;

  styleKey = key;
  const config = typstState.createSourceId(`typbase/links-config/${spaceId}`, spaceId);
  typstState.setFont(config, next.font);
  typstState.setMathFont(config, next.mathFont);
  typstState.setCodeFont(config, next.codeFont);
  typstState.setTextSize(config, next.textSize);
  // The code-block theme file referenced by the prelude is generated from the
  // palette; setting it installs that file into the world.
  typstState.setTheme(config, themeColorsFromPalette(next.palette));
}

let currentId = 0;
let releaseAnswer: ((inserted: number) => void) | undefined;
let insertedKeys = new Set<string>();
let resolving = false;
let purgePending = false;

/** Drops the cached query files; deferred while a compile is running so the
 *  request loop does not lose files mid-pass. */
function applyPurge(): void {
  if (state) {
    for (const path of insertedPaths) state.removeFile(state.createFileId(path));
  }
  insertedPaths.clear();
}

self.addEventListener(
  "message",
  async (event: MessageEvent<LinkWorkerRequest | LinkWorkerResponse>) => {
    const message = event.data;

    if (message.type === "configure") {
      wasmModuleUrl = message.wasmUrl;
      if (message.style) style = message.style;

      return;
    }

    if (message.type === "insert" && state) {
      const payload = message.payload;
      if (payload) {
        installPayload(state, payload);
        insertedKeys.add(payloadKey(payload));
        if (payload.type !== "package") insertedPaths.add(payload.path);
      }

      return;
    }

    if (message.type === "answer") {
      const release = releaseAnswer;
      releaseAnswer = undefined;
      release?.(message.inserted ?? 0);

      return;
    }

    if (message.type === "purge") {
      if (resolving) purgePending = true;
      else applyPurge();

      return;
    }

    if (message.type !== "resolve") return;

    currentId = message.id;
    insertedKeys = new Set();
    resolving = true;
    const { pageId, source, prelude, spaceId } = message;
    if (message.style) style = message.style;

    try {
      const typstState = await ensureState();
      if (style) applyStyle(typstState, style, spaceId);

      // One source file per page: file ids intern by path, so a shared path
      // would leak one page's text into another page's compile.
      const file = typstState.createSourceId(`typbase/links/${pageId}`, spaceId);
      typstState.insertSource(file, source);

      await runPasses(
        () => typstState.renderHtml(file, source, prelude),
        (rendered) =>
          post({
            id: currentId,
            type: "result",
            ok: true,
            targets: extractPageTargets(rendered.document ?? ""),
          }),
      );
    } catch (error) {
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      resolving = false;
      if (purgePending) {
        purgePending = false;
        applyPurge();
      }
    }
  },
);

interface RequestPass {
  requests: TypstRequest[];
}

/** Compiles until requests stop coming. A pass that inserts nothing stops
 *  with a readable error instead of looping. */
async function runPasses<T extends RequestPass>(
  run: () => T,
  settle: (result: T) => void,
): Promise<void> {
  for (let pass = 0; pass < 8; pass++) {
    const result = run();
    if (!result.requests.length) {
      settle(result);

      return;
    }

    const inserted = await requestLoop(result.requests);
    if (inserted === 0) {
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: `Link resolution needs files that could not be resolved: ${result.requests
          .map(requestKey)
          .join(", ")}`,
      });

      return;
    }
  }

  post({
    id: currentId,
    type: "result",
    ok: false,
    error: "Link resolution did not converge after 8 request passes.",
  });
}

async function requestLoop(requests: TypstRequest[]): Promise<number> {
  const fresh = requests.filter((request) => !insertedKeys.has(requestKey(request)));
  if (!fresh.length) return 0;

  postMessage({ id: currentId, type: "request", requests: fresh } satisfies LinkWorkerResponse);

  return new Promise<number>((resolve) => {
    releaseAnswer = resolve;
  });
}

function post(response: LinkWorkerResponse): void {
  (self as unknown as Worker).postMessage(response);
}
