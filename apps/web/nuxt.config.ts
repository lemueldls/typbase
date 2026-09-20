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

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  srcDir: "src",
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
      script: [
        {
          // Runs before first paint. The workspace doc is async, so without
          // this the boot splash paints in the default palette and then
          // switches; the cache holds the exact vars applyThemeToDom writes.
          innerHTML:
            '(function(){try{var raw=localStorage.getItem("typbase:themeCache");if(!raw)return;var vars=JSON.parse(raw).vars;if(!vars)return;var root=document.documentElement;for(var key in vars)root.style.setProperty(key,vars[key]);}catch(e){}})();',
          tagPosition: "head",
        },
      ],
    },
  },
  vite: {
    // experimental: { bundledDev: true },
    optimizeDeps: {
      exclude: ["loro-crdt", "sqlite-wasm-vec", "harper.js", "harper.js/binaryInlined"],
      // include: ["@typbase/wasm"],
      // force: true,
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
      routes: [
        "/",
        // Static client metadata documents: the PDS fetches them by URL and
        // they only depend on NUXT_PUBLIC_APP_URL, so a static deploy needs no
        // worker for sign-in. See `server/routes/oauth-client-metadata*`.
        "/oauth-client-metadata.json",
        "/oauth-client-metadata/native.json",
      ],
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
