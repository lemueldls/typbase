import { isTauri } from "@typbase/storage";

/**
 * Android system bar icons follow the app's resolved theme. `enableEdgeToEdge`
 * picks the tint from the system dark mode, so a light workspace on a dark
 * phone drew white icons over the white app surface. `applyThemeToDom` writes
 * `data-theme`. The pre-paint script may have set it before this plugin runs.
 */
export default defineNuxtPlugin(() => {
  if (!isTauri() || !navigator.userAgent.includes("Android")) return;

  let applied: boolean | undefined;

  const apply = () => {
    const light = document.documentElement.dataset.theme !== "dark";
    if (light === applied) return;

    applied = light;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("system_bars_light", { light }).catch((cause) => {
        console.warn("[system-bars] failed:", cause);
      }),
    );
  };

  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  apply();
});
