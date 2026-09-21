/**
 * Embedding worker: transformers.js feature extraction. The model downloads
 * on first use (~9MB quantized for bge-small) and is cached by the browser; semantic
 * search is off until the user turns it on in settings, and the UI reports
 * model state here.
 */

import type { FeatureExtractionPipeline, ProgressInfo } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | undefined;
let loadedModel = "";

export interface EmbedRequest {
  id: number;
  type: "embed";
  texts: string[];
  model: string;
}

export interface EmbedResponse {
  id: number;
  type: "result" | "error";
  vectors?: number[][];
  error?: string;
}

/** Download progress for the palette; not tied to one embed request. */
export interface EmbedProgress {
  type: "progress";
  progress: number;
}

const onProgress = (info: ProgressInfo | { status: string }) => {
  if ((info.status === "progress" || info.status === "progress_total") && "progress" in info) {
    postMessage({ type: "progress", progress: info.progress } satisfies EmbedProgress);
  }
};

self.addEventListener("message", async (event: MessageEvent<EmbedRequest>) => {
  const { id, texts, model } = event.data;
  try {
    if (!extractor || loadedModel !== model) {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      try {
        extractor = await pipeline("feature-extraction", model, {
          dtype: "q8" as never,
          progress_callback: onProgress,
        });
      } catch {
        // Models without a quantized ONNX file only ship fp32, so a custom
        // model id still works after the smaller download fails.
        extractor = await pipeline("feature-extraction", model, {
          dtype: "fp32" as never,
          progress_callback: onProgress,
        });
      }
      loadedModel = model;
    }
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const tensors = Array.isArray(output) ? output : [output];
    const vectors: number[][] = [];
    // A batch comes back as one [texts.length, dim] tensor; split it so each
    // text keeps its own row. Tensor's surface differs per branch, so pull the
    // data out explicitly and trust the last dimension.
    for (const tensor of tensors) {
      const data = tensor.data as Float32Array;
      const dim = tensor.dims[tensor.dims.length - 1] ?? data.length;
      for (let start = 0; start < data.length; start += dim) {
        vectors.push(Array.from(data.subarray(start, start + dim)));
      }
    }
    postMessage({ id, type: "result", vectors } satisfies EmbedResponse);
  } catch (error) {
    postMessage({
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies EmbedResponse);
  }
});
