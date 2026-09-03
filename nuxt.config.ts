// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2026-08-31",
  devtools: { enabled: true },
  future: { compatibilityVersion: 5 },
  modules: ["@nuxt/icon", "@nuxtjs/i18n", "@vueuse/nuxt/module", "reka-ui/nuxt"],
  icon: {
    // Bundle the lucide set into the build so icons never hit the Iconify
    // API at runtime (fully offline, matches the local-first story).
    // clientBundle.scan inlines the used icons for static deploys (Pages),
    // where there is no icon server endpoint.
    serverBundle: { collections: ["lucide"] },
    clientBundle: { scan: true },
  },
  css: ["~/assets/main.css"],
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
      // The public origin the OAuth client_id is minted from. Dev defaults
      // to the local dev server; CI/deploy sets NUXT_PUBLIC_APP_URL.
      appUrl: "http://localhost:3000",
      // PDS the app talks to. Empty means the user's PDS from DID documents;
      // dev sets this to the local Docker PDS (NUXT_PUBLIC_PDS_URL).
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
    locales: [
      { code: "en", name: "English", file: "en.json" },
      { code: "es", name: "Español", file: "es.json" },
      { code: "de", name: "Deutsch", file: "de.json" },
      { code: "fr", name: "Français", file: "fr.json" },
      { code: "zh", name: "中文", file: "zh.json" },
    ],
    defaultLocale: "en",
    strategy: "no_prefix",
    detectBrowserLanguage: { useCookie: false, redirectOn: "root" },
  },
});
