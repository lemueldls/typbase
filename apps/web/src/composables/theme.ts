import type { WorkspaceStore } from "@typbase/storage";
import type { ThemeMode, ThemePaletteTokens } from "@typbase/typing";

import {
  applyThemeToDom,
  cacheThemeSettings,
  rendererPaletteFor,
  resolveTheme,
  type AppChromeSettings,
  type ResolvedTheme,
} from "~/lib/themes";

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
  themeCustom?: ThemePaletteTokens | null;
}): ResolvedTheme {
  return resolveTheme(settings);
}

export function applyTheme(
  settings: Parameters<typeof resolveAppTheme>[0] & AppChromeSettings,
): ResolvedTheme {
  const resolved = resolveAppTheme(settings);
  applyThemeToDom(resolved, settings);
  cacheThemeSettings(settings);

  return resolved;
}

export function useTheme(getStore: () => WorkspaceStore | undefined) {
  let detach: (() => void) | undefined;

  function refresh(): void {
    const store = getStore();
    if (store) applyTheme(store.getSettings());
  }

  // Follow the active workspace: a switch detaches the old doc's listener and
  // repaints from the new one's settings. The structure echo covers the
  // settings select and changes synced from other devices. Never gated: the
  // first change must repaint the editor even if the initial refresh never ran.
  watch(
    getStore,
    (store) => {
      detach?.();
      detach = undefined;
      if (!store) return;

      detach = store.onStructureChange(refresh);
      refresh();
    },
    { immediate: true },
  );

  function onMediaChange(): void {
    const store = getStore();
    if (store && (store.getSettings().theme ?? "auto") === "auto") refresh();
  }

  media?.addEventListener?.("change", onMediaChange);

  onScopeDispose(() => {
    detach?.();
    media?.removeEventListener?.("change", onMediaChange);
  });

  return { refresh };
}

/** ThemeColors for the current settings, used when compiling previews. */
export function currentThemeColors(settings: Parameters<typeof resolveAppTheme>[0]) {
  return rendererPaletteFor(resolveAppTheme(settings));
}
