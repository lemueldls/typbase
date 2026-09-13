import init, { FileId, TypstState, type TypstRequest } from "@typbase/wasm";
import mapleMonoBold from "~~/public/fonts/maple/MapleMono-Bold.ttf?url";
import mapleMonoBoldItalic from "~~/public/fonts/maple/MapleMono-BoldItalic.ttf?url";
import mapleMonoItalic from "~~/public/fonts/maple/MapleMono-Italic.ttf?url";
import mapleMono from "~~/public/fonts/maple/MapleMono-Regular.ttf?url";
import newcmMathBold from "~~/public/fonts/math/NewCMMath-Bold.otf?url";
import newcmMath from "~~/public/fonts/math/NewCMMath-Regular.otf?url";

import type { RenderWorkerRequest, RenderWorkerResponse } from "~/lib/renderWorker";

/**
 * Worker entry: owns one TypstState for publish renders. The page source and
 * prelude arrive with each request; `#typbase.query` and `#typbase.embed`
 * resolve through the main thread, which posts insert messages that land in
 * THIS instance (file ids are created from the request paths, so the world's
 * roots stay consistent). Compiles loop until no requests remain.
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

let currentId = 0;
let releaseAnswer: (() => void) | undefined;

self.addEventListener(
  "message",
  async (event: MessageEvent<RenderWorkerRequest | RenderWorkerResponse>) => {
    const message = event.data;

    if (message.type === "insert" && state) {
      if (message.payload?.type === "source") {
        state.insertSource(state.createFileId(message.payload.path), message.payload.text);
      } else if (message.payload?.type === "file") {
        state.insertFile(state.createFileId(message.payload.path), message.payload.bytes);
      }

      return;
    }

    if (message.type === "answer") {
      const release = releaseAnswer;
      releaseAnswer = undefined;
      release?.();

      return;
    }

    if (message.type !== "render") return;

    currentId = message.id;
    const { pagePath, source, prelude, wants } = message;

    try {
      const typstState = await ensureState();
      const file = typstState.createFileId(pagePath);
      typstState.insertSource(file, source);

      if (wants === "pdf") {
        if (!typstState.pdfAvailable()) {
          postMessage({
            id: currentId,
            type: "result",
            ok: false,
            error: "This build has no PDF support (rebuild with the pdf feature).",
          } satisfies RenderWorkerResponse);

          return;
        }

        // renderPdf is compiled behind the wasm `pdf` feature and absent
        // from the default build's typings; pdfAvailable() proved the call
        // is safe. RenderPdfResult mirrors the Rust struct.
        const pdfState = typstState as unknown as {
          renderPdf(
            id: FileId,
            text: string,
            prelude: string,
          ): {
            bytes?: Uint8Array;
            diagnostics?: unknown[];
            requests: TypstRequest[];
          };
        };
        const rendered = pdfState.renderPdf(file, source, prelude);
        if (rendered.requests.length) await requestLoop(rendered.requests);
        postMessage({
          id: currentId,
          type: "result",
          ok: true,
          pdf: rendered.bytes ? new Uint8Array(rendered.bytes) : undefined,
          diagnostics: rendered.diagnostics,
        } satisfies RenderWorkerResponse);

        return;
      }

      for (let pass = 0; pass < 8; pass++) {
        const rendered = typstState.renderHtml(file, source, prelude);
        if (rendered.requests.length) {
          await requestLoop(rendered.requests);
          continue;
        }
        postMessage({
          id: currentId,
          type: "result",
          ok: true,
          html: rendered.document ?? undefined,
          diagnostics: rendered.diagnostics,
        } satisfies RenderWorkerResponse);

        return;
      }
      postMessage({
        id: currentId,
        type: "result",
        ok: false,
        error: "Render did not converge after 8 request passes.",
      } satisfies RenderWorkerResponse);
    } catch (error) {
      postMessage({
        id: currentId,
        type: "result",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RenderWorkerResponse);
    }
  },
);

async function requestLoop(requests: TypstRequest[]): Promise<void> {
  postMessage({
    id: currentId,
    type: "request",
    requests,
  } satisfies RenderWorkerResponse);
  await new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
}
