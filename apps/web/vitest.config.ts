import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit suite: pure modules with no Nuxt runtime, currently the AI provider
 * stream parsers. The full-app suite lives in `vitest.config.e2e.ts`.
 *
 *   pnpm test:unit
 */
export default defineConfig({
  resolve: {
    // Pure modules still import each other through the app alias.
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
