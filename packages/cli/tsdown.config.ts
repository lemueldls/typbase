import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  deps: {
    // Bundle the workspace schema packages and the atproto client so the
    // published bin runs without resolving TypeScript sources under
    // node_modules.
    alwaysBundle: [/^@typbase\/(skin|typing|plugin-sdk|spaces)/, /^airspace(\/|$)/, /^@atproto\//],
  },
});
