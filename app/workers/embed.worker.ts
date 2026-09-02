/**
 * Embedding worker: transformers.js feature extraction. The model downloads
 * on first use (~30MB for bge-small) and is cached by the browser; semantic
 * search is off until the user turns it on in settings, and the UI reports
 * model state here.
 */

let extractor: import("@huggingface/transformers").FeatureExtractionPipeline | undefined;
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

self.addEventListener("message", async (event: MessageEvent<EmbedRequest>) => {
  const { id, texts, model } = event.data;
  try {
    if (!extractor || loadedModel !== model) {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      extractor = await pipeline("feature-extraction", model, {
        dtype: "q8" as never,
      });
      loadedModel = model;
    }
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const tensors = Array.isArray(output) ? output : [output];
    const vectors: number[][] = [];
    // Tensor's surface differs per branch, so pull the data out explicitly.
    for (const tensor of tensors) {
      vectors.push(Array.from(tensor.data as Float32Array));
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
