import { isTauri } from "@typbase/storage";

/**
 * Registers the offline shell worker on the web build. Tauri ships its own
 * assets and never needs it, and dev keeps the worker out so Vite's module
 * URLs stay fresh.
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev || isTauri() || !window.isSecureContext) return;
  if (!("serviceWorker" in navigator)) return;

  // Persistent storage keeps OPFS and the shell cache from being evicted.
  void navigator.storage?.persist?.().catch(() => {
    // Denied or unsupported, but both stores still work until eviction.
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((cause) => {
      console.warn("[sw] registration failed:", cause);
    });
  });
});
