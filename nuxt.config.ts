import type { LocaleObject } from "@nuxtjs/i18n";

import { fileURLToPath } from "node:url";
import { defineNuxtConfig } from "nuxt/config";

const defaultLocale = "en";
const locales: LocaleObject[] = [
  { code: "en", dir: "ltr", language: "en-US", file: "en.json" },
  { code: "es", dir: "ltr", language: "es-ES", file: "es.json" },
  { code: "fr", dir: "ltr", language: "fr-FR", file: "fr.json" },
  { code: "de", dir: "ltr", language: "de-DE", file: "de.json" },
  { code: "zh", dir: "ltr", language: "zh-CN", file: "zh.json" },
];

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2026-08-31",
  devtools: { enabled: false },
  future: { compatibilityVersion: 5 },
  modules: ["@nuxtjs/i18n", "@vueuse/nuxt/module", "reka-ui/nuxt"],
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      title: "Typbase",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content: "Local-first knowledge base built around the Typst language.",
        },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    },
  },
  vite: {
    // experimental: { bundledDev: true },
    resolve: {
      alias: {
        "node:dns/promises": fileURLToPath(new URL("./app/lib/node-dns-shim.ts", import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ["loro-crdt", "sqlite-wasm-vec", "harper.js", "harper.js/binaryInlined"],
      include: ["@typbase/wasm"],
    },
    server: {
      // middlewareMode: false,
    },
  },
  runtimeConfig: {
    public: {
      appUrl: "http://localhost:3000",
      pdsUrl: "",
    },
  },
  nitro: {
    features: {
      // websocket: true,
    },
    prerender: {
      routes: ["/"],
      crawlLinks: true,
    },
    routeRules: {
      "/**": {
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "credentialless",
        },
      },
    },
  },
  i18n: {
    locales,
    defaultLocale,
    strategy: "no_prefix",
  },
});
