// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2026-08-31",
  devtools: { enabled: true },
  future: { compatibilityVersion: 5 },
  modules: ["@vueuse/nuxt/module", "reka-ui/nuxt"],
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
  // Cross-origin isolation for the SQLite OPFS VFS. credentialless (not
  // require-corp) so PDS blob fetches and model downloads keep working.
  devServer: {
    // headers: {
    //   "Cross-Origin-Opener-Policy": "same-origin",
    //   "Cross-Origin-Embedder-Policy": "credentialless",
    // },
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
    // prerender: {
    //   routes: ["/"],
    //   crawlLinks: true,
    // },
    // routeRules: {
    //   "/**": {
    //     headers: {
    //       "Cross-Origin-Opener-Policy": "same-origin",
    //       "Cross-Origin-Embedder-Policy": "credentialless",
    //     },
    //   },
    // },
  },
});
