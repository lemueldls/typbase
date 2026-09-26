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
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        {
          name: "description",
          content: "Local-first knowledge base made for Typst and the Atmosphere.",
        },
        { property: "og:site_name", content: "Typbase" },
        { name: "twitter:card", content: "summary" },
      ],
      link: [{ rel: "icon", type: "image/x-icon", href: "favicon.ico" }],
      script: [
        {
          // Runs before first paint. The workspace doc is async, so without
          // this the boot splash paints in the default palette and then
          // switches; the cache holds the exact vars applyThemeToDom writes.
          // With no cache (first run, or unreadable storage) it follows the
          // OS: #1b1d21 is the default theme's dark surface, so a dark-mode
          // launch never paints a white canvas before the workspace lands.
          innerHTML:
            '(function(){var root=document.documentElement;try{var raw=localStorage.getItem("typbase:themeCache");if(raw){var cached=JSON.parse(raw);var vars=cached.vars;if(vars){for(var key in vars)root.style.setProperty(key,vars[key]);if(vars["--color-surface"])root.style.backgroundColor=vars["--color-surface"];}if(cached.mode){root.dataset.theme=cached.mode;root.style.colorScheme=cached.mode;}return;}}catch(e){}try{if(!window.matchMedia||!window.matchMedia("(prefers-color-scheme: dark)").matches)return;root.dataset.theme="dark";root.style.colorScheme="dark";root.style.backgroundColor="#1b1d21";}catch(e){}})();',
          tagPosition: "head",
        },
      ],
    },
  },
  vite: {
    plugins: [
      {
        name: "typbase:dev-coep",
        apply: "serve",
        configureServer(server) {
          // Vite serves worker scripts itself and bypasses Nitro's routeRules,
          // so they miss the COOP/COEP the document has. Chromium refuses to
          // create a worker under COEP unless the worker response carries them
          // too, which silently blocked every worker in dev.
          server.middlewares.use((_request, response, next) => {
            response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        // Loro's exports map sends the production client build to its
        // `browser` entry, which loads the wasm with a synchronous XHR. The
        // `bundler` entry imports the wasm as a module (the path dev already
        // resolves), so Vite handles it and nothing blocks the main thread.
        "loro-crdt": "loro-crdt/bundler",
      },
    },
    // experimental: { bundledDev: true },
    optimizeDeps: {
      exclude: ["loro-crdt", "sqlite-wasm-vec", "harper.js", "harper.js/binaryInlined"],
    },
    server: {
      // middlewareMode: false,
    },
  },
  runtimeConfig: {
    public: {
      appUrl: "http://localhost:3000",
      pdsUrl: "",
      relayUrl: "",
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
