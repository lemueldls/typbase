import { isTauri } from "@typbase/storage";

/**
 * Opens a URL outside the app. A Tauri webview has no tab strip, so
 * `window.open` would be dropped; the opener plugin hands the URL to the
 * system browser instead.
 */
export function openExternal(url: string): void {
  if (isTauri()) {
    void import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(url))
      .catch((cause) => console.error("[external] open failed:", cause));

    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
