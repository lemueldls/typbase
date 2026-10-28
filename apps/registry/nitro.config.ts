import { defineConfig } from "nitro";

export default defineConfig({
  compatibilityDate: "2026-10-21",
  serverDir: "./",
  devServer: { port: 3002 },
  runtimeConfig: {
    registryPublishers: process.env.REGISTRY_PUBLISHERS ?? "",
  },
  cloudflare: {
    wrangler: {
      name: process.env.REGISTRY_WORKER_NAME ?? "typbase-registry",
      compatibility_date: "2026-10-21",
    },
  },
  routeRules: {
    "/api/**": {
      cors: true,
      headers: { "access-control-max-age": "300" },
    },
  },
});
