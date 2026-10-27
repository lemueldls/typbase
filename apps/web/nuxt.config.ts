import type { LocaleObject } from "@nuxtjs/i18n";

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineNuxtConfig } from "nuxt/config";
import { build as rolldownBuild } from "rolldown";
import { minifySync } from "rolldown/utils";

const defaultLocale = "en";
const appDescription = "Local-first knowledge base made for Typst and the Atmosphere.";
const siteCssFile = fileURLToPath(new URL("./src/lib/site/templates/site.css", import.meta.url));
const siteRuntimeDir = fileURLToPath(new URL("./src/lib/site/templates/runtime", import.meta.url));

/** Minify one of the inline head scripts from its readable source. */
function inlineScript(name: string): string {
  const file = fileURLToPath(new URL(`./scripts/${name}`, import.meta.url));
  const source = readFileSync(file, "utf8");
  const result = minifySync(file, source, {
    compress: { target: "es2020" },
    mangle: true,
    codegen: true,
  });
  if (result.errors.length) {
    throw new Error(`Failed to minify ${name}: ${result.errors.map(String).join(", ")}`);
  }

  return result.code.trim();
}

const runtimeEntries = {
  "virtual:typbase-site-script": "site.ts",
  "virtual:typbase-graph-script": "graph.ts",
} as const;

async function bundleRuntime(entry: string): Promise<string> {
  const result = await rolldownBuild({
    input: fileURLToPath(new URL(`./src/lib/site/templates/runtime/${entry}`, import.meta.url)),
    platform: "browser",
    write: false,
    logLevel: "silent",
    output: { format: "iife", minify: true },
  });
  const chunk = result.output.find((item) => item.type === "chunk");
  if (!chunk) throw new Error(`Site runtime bundle for ${entry} produced no chunk.`);

  return chunk.code.trim();
}

interface DevServer {
  watcher: { add(path: string): void; on(event: "change", listener: (file: string) => void): void };
  moduleGraph: {
    getModuleById(id: string): { id: string } | undefined;
    invalidateModule(module: { id: string }): void;
  };
  ws: { send(payload: { type: string }): void };
}

/** Compile the published site's vanilla runtimes from TS modules at build time. */
function siteRuntimePlugin() {
  return {
    name: "typbase:site-runtime",
    resolveId(id: string) {
      return id in runtimeEntries ? `\0${id}` : null;
    },
    async load(id: string) {
      if (!id.startsWith("\0virtual:typbase-")) return null;
      const key = id.slice(1) as keyof typeof runtimeEntries;
      const entry = runtimeEntries[key];
      if (!entry) return null;
      const code = await bundleRuntime(entry);

      return `export default ${JSON.stringify(code)};`;
    },
    configureServer(server: DevServer) {
      server.watcher.add(siteRuntimeDir);
      server.watcher.on("change", (file: string) => {
        if (!file.startsWith(siteRuntimeDir)) return;
        for (const id of Object.keys(runtimeEntries)) {
          const mod = server.moduleGraph.getModuleById(`\0${id}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

const oauthCallbackScript = inlineScript("oauth-callback.js");
const themeCacheScript = inlineScript("theme-cache.js");
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
          innerHTML: oauthCallbackScript,
          tagPosition: "head",
        },
        {
          innerHTML: themeCacheScript,
          tagPosition: "head",
        },
      ],
    },
  },
  vite: {
    plugins: [
      siteRuntimePlugin(),
      {
        name: "typbase:site-css",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:typbase-site-css") return "\0virtual:typbase-site-css";

          return null;
        },
        buildStart() {
          this.addWatchFile(siteCssFile);
        },
        async load(id) {
          if (id !== "\0virtual:typbase-site-css") return null;

          return `export default ${JSON.stringify(await readFile(siteCssFile, "utf8"))};`;
        },
        configureServer(server) {
          server.watcher.add(siteCssFile);
          server.watcher.on("change", (file) => {
            if (file !== siteCssFile) return;

            const mod = server.moduleGraph.getModuleById("\0virtual:typbase-site-css");
            if (mod) server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
          });
        },
      },
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
        // unifont imports node:process for its Node proxy dispatcher. The
        // browser build has no proxy env, so the shim keeps it inert.
        "node:process": fileURLToPath(new URL("./src/lib/nodeProcessShim.ts", import.meta.url)),
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
      nativeAppUrl: "",
      pdsUrl: "",
      proxyUrl: process.env.NODE_ENV === "development" ? "http://localhost:3001" : "",
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
