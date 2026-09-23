import { defineConfig } from "vitest/config";

/**
 * Unit suite: pure modules with no Nuxt runtime, currently the AI provider
 * stream parsers. The full-app suite lives in `vitest.config.e2e.ts`.
 *
 *   pnpm test:unit
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
