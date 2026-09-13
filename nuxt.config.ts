import type { LocaleObject } from "@nuxtjs/i18n";

import { defineNuxtConfig } from "nuxt/config";

const defaultLocale = "en";
const locales: LocaleObject[] = [
  { code: "en", dir: "ltr", language: "en-US", file: "en.json" },
  { code: "es", dir: "ltr", language: "es-ES", file: "es.json" },
  { code: "fr", dir: "ltr", language: "fr-FR", file: "fr.json" },
  { code: "de", dir: "ltr", language: "de-DE", file: "de.json" },
  { code: "zh", dir: "ltr", language: "zh-CN", file: "zh.json" },
];

// const isDev = process.env.NODE_ENV === "development";
// const platform: string = import.meta.env.TAURI_ENV_PLATFORM;
// const internalHost = import.meta.env.TAURI_DEV_HOST || "localhost";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2026-08-31",
  devtools: { enabled: true },
  future: { compatibilityVersion: 5 },
  modules: ["@nuxtjs/i18n", "@vueuse/nuxt/module", "reka-ui/nuxt"],
  css: ["~/assets/css/main.css"],
  vite: {
    // experimental: { bundledDev: true },
    optimizeDeps: {
      exclude: ["loro-crdt", "sqlite-wasm-vec"],
    },
    server: {
      // middlewareMode: false,
      // headers: {
      //   "Cross-Origin-Opener-Policy": "same-origin",
      //   "Cross-Origin-Embedder-Policy": "credentialless",
      // },
    },
  },
  runtimeConfig: {
    public: {
      // platform,
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
