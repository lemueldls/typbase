import { isTauri } from "@typbase/storage";

/**
 * Android hardware back. The webview's history drives the app: back closes the
 * top overlay or returns to the previous page, and only exits at the root.
 */
export default defineNuxtPlugin(() => {
  if (!isTauri() || !navigator.userAgent.includes("Android")) return;

  void Promise.all([import("@tauri-apps/api/app"), import("@tauri-apps/plugin-process")])
    .then(([{ onBackButtonPress }, { exit }]) =>
      onBackButtonPress(({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();

          return;
        }

        void exit(0);
      }),
    )
    .catch((cause) => {
      console.warn("[back] Android listener failed:", cause);
    });
});
