import type { LocaleObject } from "@nuxtjs/i18n";

import { readFile } from "node:fs/promises";
import { defineNuxtConfig } from "nuxt/config";

const defaultLocale = "en";
const appDescription = "Local-first knowledge base made for Typst and the Atmosphere.";
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
        { name: "description", content: appDescription },
        { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#1b1d21", media: "(prefers-color-scheme: dark)" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Typbase" },
        { property: "og:title", content: "Typbase" },
        { property: "og:description", content: appDescription },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Typbase" },
      ],
      link: [
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "manifest", href: "/site.webmanifest" },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      ],
      script: [
        {
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
          server.middlewares.use((request, response, next) => {
            response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");

            if (request.url?.split("?")[0] === "/sw.js") {
              void readFile(new URL("./public/sw.js", import.meta.url), "utf8").then(
                (source) => {
                  response.setHeader("Content-Type", "text/javascript");
                  response.end(source);
                },
                () => next(),
              );

              return;
            }

            next();
          });
        },
      },
      {
        name: "typbase:external-onnx-wasm",
        apply: "build",
        generateBundle(_options, bundle) {
          for (const fileName of Object.keys(bundle)) {
            if (fileName.endsWith(".wasm") && fileName.includes("ort-wasm-simd-threaded")) {
              delete bundle[fileName];
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
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
      routes: ["/", "/oauth-client-metadata.json", "/oauth-client-metadata/native.json"],
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
