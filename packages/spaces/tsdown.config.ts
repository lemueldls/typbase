import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/pluginRegistry.ts", "src/themeRegistry.ts"],
});
