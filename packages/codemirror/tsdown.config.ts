import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // `"type": "module"` packages: keep the canonical .js/.d.ts names that
  // package.json exports point at (tsdown defaults to .mjs for esm).
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  dts: true,
  clean: true,
});
