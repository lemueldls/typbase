import type { WorkspaceStore } from "@typbase/storage";
import type { ThemeMode } from "@typbase/typing";

import {
  applyThemeToDom,
  cacheThemeSettings,
  rendererPaletteFor,
  resolveTheme,
  type ResolvedTheme,
} from "~/lib/themes";

/**
 * App theming. The workspace settings (`settings.theme` mode + `themeName`
 * palette) are synced through Loro; this composable applies the resolved
 * palette to `document.documentElement` and follows the OS preference while
 * in "auto". Wired once at the shell (index.vue); the Typst renderer colors
 * are derived from the same tokens through rendererPaletteFor.
 */

const media =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    return media?.matches ? "dark" : "light";
  }

  return mode;
}

export function resolveAppTheme(settings: {
  theme: ThemeMode;
  themeName?: string;
  themeCustom?: import("@typbase/typing").ThemePaletteTokens | null;
}): ResolvedTheme {
  return resolveTheme(settings);
}

export function applyTheme(
  settings: Parameters<typeof resolveAppTheme>[0],
): ResolvedTheme {
  const resolved = resolveAppTheme(settings);
  applyThemeToDom(resolved);
  cacheThemeSettings(settings);
  return resolved;
}

export function useTheme(store: WorkspaceStore) {
  function refresh(): void {
    applyTheme(store.getSettings());
  }

  media?.addEventListener?.("change", () => {
    const mode = store.getSettings().theme ?? "auto";
    if (mode === "auto") refresh();
  });

  // The settings select updates the store; re-apply on the echo too (covers
  // changes from other devices and renames). Never gated: the first change
  // must repaint the editor even if the initial refresh never ran.
  store.onStructureChange(() => {
    refresh();
  });

  return { refresh };
}

/** ThemeColors for the current settings, used when compiling previews. */
export function currentThemeColors(
  settings: Parameters<typeof resolveAppTheme>[0],
) {
  return rendererPaletteFor(resolveAppTheme(settings));
}
