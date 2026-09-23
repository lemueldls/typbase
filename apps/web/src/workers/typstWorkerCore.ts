import type { TypstRequest, TypstState } from "@typbase/engine";

import init, { TypstState as TypstStateClass } from "@typbase/engine";
import mapleMonoBold from "~~/public/fonts/maple/MapleMono-Bold.ttf?url";
import mapleMonoBoldItalic from "~~/public/fonts/maple/MapleMono-BoldItalic.ttf?url";
import mapleMonoItalic from "~~/public/fonts/maple/MapleMono-Italic.ttf?url";
import mapleMono from "~~/public/fonts/maple/MapleMono-Regular.ttf?url";
import newcmMathBold from "~~/public/fonts/math/NewCMMath-Bold.otf?url";
import newcmMath from "~~/public/fonts/math/NewCMMath-Regular.otf?url";

import type { RequestPayload } from "~/lib/typstRequests";

import { specString } from "~/lib/packages";

/**
 * Plumbing shared by the render and chat workers: the wasm instance with the
 * bundled fonts, and the request/payload keying the main thread uses to
 * resolve `#typbase.query`, embeds, media, and packages.
 */

export const BUNDLED_FONT_URLS: string[] = [
  mapleMono,
  mapleMonoItalic,
  mapleMonoBold,
  mapleMonoBoldItalic,
  newcmMath,
  newcmMathBold,
];

export async function initTypstState(wasmUrl: string): Promise<TypstState> {
  await init({ module_or_path: wasmUrl });
  const state = new TypstStateClass();
  for (const url of BUNDLED_FONT_URLS) {
    const response = await fetch(url);
    state.installFont(new Uint8Array(await response.arrayBuffer()));
  }

  return state;
}

/** A request and a payload key for the same file or package must match. */
export function requestKey(request: TypstRequest): string {
  return typeof request.value === "string" ? request.value : specString(request.value);
}

export function payloadKey(payload: RequestPayload): string {
  return payload.type === "package" ? specString(payload.spec) : payload.path;
}

/** Installs one resolved payload into a worker's wasm world. */
export function installPayload(state: TypstState, payload: RequestPayload): void {
  if (payload.type === "source") {
    state.insertSource(state.createFileId(payload.path), payload.text);
  } else if (payload.type === "file") {
    state.insertFile(state.createFileId(payload.path), payload.bytes);
  } else {
    state.installPackage(specString(payload.spec), payload.bytes);
  }
}
