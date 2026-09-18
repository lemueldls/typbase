/**
 * A minimal readable text handle. Vue refs (`Ref<string>`) satisfy this shape
 * structurally, so both mnemo and Typbase can pass their refs unchanged.
 */
export interface TextRef {
  value: string;
}

/** Resolves the files a compile asked for (query JSON, embedded pages). */
export type TypstRequestHandler = (
  requests: import("@typbase/wasm").TypstRequest[],
  spaceId: string,
) => Promise<boolean> | boolean;
