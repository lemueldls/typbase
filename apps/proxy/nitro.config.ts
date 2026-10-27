import { defineConfig } from "nitro";

export default defineConfig({
  compatibilityDate: "2026-10-21",
  serverDir: "./",
  features: {
    websocket: true,
  },
  cloudflare: {
    wrangler: {
      name: "typbase-proxy",
      durable_objects: {
        bindings: [{ name: "$DurableObject", class_name: "$DurableObject" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["$DurableObject"] }],
    },
  },
  devServer: {
    port: 3001,
  },
  routeRules: {
    "/fonts": {
      cors: true,
      headers: {
        "access-control-max-age": "21600",
        "x-proxy-status": "experimental; see https://github.com/unjs/unifont/tree/main/proxy",
      },
    },
    "/fonts/**": {
      cors: true,
      headers: {
        "access-control-max-age": "21600",
        "x-proxy-status": "experimental; see https://github.com/unjs/unifont/tree/main/proxy",
      },
    },
    "/wisp/**": {
      cors: true,
      headers: {
        "access-control-max-age": "86400",
      },
    },
  },
});
