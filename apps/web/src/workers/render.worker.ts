import type { TypstRequest } from "@typbase/engine";

import init, { TypstState } from "@typbase/engine";
import mapleMonoBold from "~~/public/fonts/maple/MapleMono-Bold.ttf?url";
import mapleMonoBoldItalic from "~~/public/fonts/maple/MapleMono-BoldItalic.ttf?url";
import mapleMonoItalic from "~~/public/fonts/maple/MapleMono-Italic.ttf?url";
import mapleMono from "~~/public/fonts/maple/MapleMono-Regular.ttf?url";
import newcmMathBold from "~~/public/fonts/math/NewCMMath-Bold.otf?url";
import newcmMath from "~~/public/fonts/math/NewCMMath-Regular.otf?url";

import type { RenderWorkerRequest, RenderWorkerResponse } from "~/lib/renderWorker";
import type { RequestPayload } from "~/lib/typstRequests";

import { specString } from "~/lib/packages";
import { themeColorsFromPalette } from "~/lib/rendererPalette";

/**
 * Worker entry: owns one TypstState for publish and export renders. The page
 * source and prelude arrive with each request; `#typbase.query` and
 * `#typbase.embed` resolve through the main thread, which posts insert
 * messages that land in THIS instance (file ids are created from the request
 * paths, so the world's roots stay consistent). Compiles loop until no
 * requests remain; a pass that makes no progress stops instead of recompiling.
 */

/** The wasm asset URL arrives in a configure message; the main thread already
 *  loaded it, and worker-side asset resolution is not portable. */
let wasmModuleUrl: string | undefined;
let state: TypstState | undefined;

async function ensureState(): Promise<TypstState> {
  if (state) return state;
  if (!wasmModuleUrl) throw new Error("Render worker was not configured with a wasm URL");

  await init({ module_or_path: wasmModuleUrl });
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

let currentId = 0;
let releaseAnswer: ((inserted: number) => void) | undefined;
/** Request keys already inserted for the current render. A pass that asks
 *  only for these has made no progress and must not loop. */
let insertedKeys = new Set<string>();

/** A request and a payload key for the same file or package must match. */
function requestKey(request: TypstRequest): string {
  return typeof request.value === "string" ? request.value : specString(request.value);
}

function payloadKey(payload: RequestPayload): string {
  return payload.type === "package" ? specString(payload.spec) : payload.path;
}

self.addEventListener(
  "message",
  async (event: MessageEvent<RenderWorkerRequest | RenderWorkerResponse>) => {
    const message = event.data;

    if (message.type === "configure") {
      wasmModuleUrl = message.wasmUrl;

      return;
    }

    if (message.type === "insert" && state) {
      const payload = message.payload;
      if (payload?.type === "source") {
        state.insertSource(state.createFileId(payload.path), payload.text);
      } else if (payload?.type === "file") {
        state.insertFile(state.createFileId(payload.path), payload.bytes);
      } else if (payload?.type === "package") {
        state.installPackage(specString(payload.spec), payload.bytes);
      }
      if (payload) insertedKeys.add(payloadKey(payload));

      return;
    }

    if (message.type === "answer") {
      const release = releaseAnswer;
      releaseAnswer = undefined;
      release?.(message.inserted ?? 0);

      return;
    }

    if (message.type !== "render") return;

    currentId = message.id;
    insertedKeys = new Set();
    const { pagePath, source, prelude, wants, merged, spaceId, theme } = message;

    try {
      const typstState = await ensureState();
      // renderHtml/renderPdf/renderSvg go through the raw/synth pipeline,
      // which needs a registered SourceContext: a plain file id panics in the
      // prelude.
      const file = typstState.createSourceId(pagePath, spaceId);
      typstState.insertSource(file, source);

      // Install the export palette so the engine's prelude (and the code-block
      // theme file it references) matches the caller prelude.
      if (theme) typstState.setTheme(file, themeColorsFromPalette(theme));

      if (wants === "svg") {
        await runPasses(
          () => typstState.renderSvg(file, source, prelude, merged ?? false),
          (rendered) =>
            post({
              id: currentId,
              type: "result",
              ok: true,
              svg: rendered.pages,
              diagnostics: rendered.diagnostics,
            }),
        );

        return;
      }

      if (wants === "pdf") {
        if (!typstState.pdfAvailable()) {
          post({
            id: currentId,
            type: "result",
            ok: false,
            error: "This build has no PDF support (rebuild with the pdf feature).",
          });

          return;
        }

        // renderPdf is compiled behind the wasm `pdf` feature and absent
        // from the default build's typings; pdfAvailable() proved the call
        // is safe. RenderPdfResult mirrors the Rust struct.
        const pdfState = typstState as unknown as {
          renderPdf(
            id: typeof file,
            text: string,
            prelude: string,
          ): {
            bytes?: Uint8Array;
            diagnostics?: unknown[];
            requests: TypstRequest[];
          };
        };

        await runPasses(
          () => pdfState.renderPdf(file, source, prelude),
          (rendered) =>
            post({
              id: currentId,
              type: "result",
              ok: true,
              pdf: rendered.bytes ? new Uint8Array(rendered.bytes) : undefined,
              diagnostics: rendered.diagnostics,
            }),
        );

        return;
      }

      await runPasses(
        () => typstState.renderHtml(file, source, prelude),
        (rendered) =>
          post({
            id: currentId,
            type: "result",
            ok: true,
            html: rendered.document ?? undefined,
            diagnostics: rendered.diagnostics,
          }),
      );
    } catch (error) {
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

interface RenderPass {
  requests: TypstRequest[];
}

/** Renders until requests stop coming, then hands the final pass to `settle`.
 *  A pass that inserts nothing stops the loop with a readable error. */
async function runPasses<T extends RenderPass>(
  render: () => T,
  settle: (rendered: T) => void,
): Promise<void> {
  for (let pass = 0; pass < 8; pass++) {
    const rendered = render();
    if (!rendered.requests.length) {
      settle(rendered);

      return;
    }

    const inserted = await requestLoop(rendered.requests);
    if (inserted === 0) {
      const missing = rendered.requests.map(requestKey).join(", ");
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: `Render needs files that could not be resolved: ${missing}`,
      });

      return;
    }
  }

  post({
    id: currentId,
    type: "result",
    ok: false,
    error: "Render did not converge after 8 request passes.",
  });
}

async function requestLoop(requests: TypstRequest[]): Promise<number> {
  const fresh = requests.filter((request) => !insertedKeys.has(requestKey(request)));
  if (!fresh.length) return 0;

  postMessage({ id: currentId, type: "request", requests: fresh } satisfies RenderWorkerResponse);

  return new Promise<number>((resolve) => {
    releaseAnswer = resolve;
  });
}

function post(response: RenderWorkerResponse): void {
  (self as unknown as Worker).postMessage(response);
}
