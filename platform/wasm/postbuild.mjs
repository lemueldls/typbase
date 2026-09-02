// wasm-pack names the package after the Cargo crate (`typst-wasm`), but the
// published name is scoped. Rewrite the manifest right after each build so the
// workspace and npm see the right name.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("./pkg/package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf8"));

manifest.name = "@typbase/wasm";

writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
