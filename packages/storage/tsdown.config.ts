import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // `"type": "module"` packages: keep the canonical .js/.d.ts names that
  // package.json exports point at (tsdown defaults to .mjs for esm).
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // The Tauri API is only present in native builds; the host app provides it.
  deps: {
    neverBundle: ["@tauri-apps/api", "@tauri-apps/api/core"],
  },
  dts: true,
  clean: true,
});
