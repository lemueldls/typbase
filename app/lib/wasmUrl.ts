// Vite 8's wasm plugin turns any `.wasm` module request into instance glue,
// and the glue in the web target's own `new URL(...)` fetch lands in that path.
// Ask Vite for the asset URL, add a query so the request is served as the raw
// binary, and hand it to init.
//
// Kept in its own module so the render worker can receive the exact same URL
// from the main thread instead of re-deriving it in a worker context, where
// asset resolution differs between bundlers and browsers.
import wasmUrl from "@typbase/wasm/wasm_bg.wasm?url";

export const wasmBinaryUrl = `${wasmUrl}${wasmUrl.includes("?") ? "&" : "?"}binary`;
