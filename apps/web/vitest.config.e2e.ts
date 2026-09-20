import { defineConfig } from "vitest/config";

/**
 * End-to-end suite: boots the real Nuxt dev server and drives Chromium through
 * Playwright (via `@nuxt/test-utils/e2e`). The tests reach into the app only
 * through the dev-only handle in `src/lib/testApi.ts`.
 *
 *   pnpm test:e2e
 */
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    // WASM engine boot and compile are slow on the dev build.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // One server and one browser context for the whole suite.
    fileParallelism: false,
  },
});
