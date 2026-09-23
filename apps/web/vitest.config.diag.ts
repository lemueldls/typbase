import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/diag.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
