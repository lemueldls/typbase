import type { ThemeMode, ThemePaletteTokens } from "@typbase/typing";

import { ThemeColors } from "@typbase/wasm";

import { themeColorsFromPalette } from "./rendererPalette";

/**
 * Theme registry. A theme is pure data: a token map for the app chrome plus
 * a light/dark classification, and the Typst renderer palette is derived
 * from the same tokens so published pages match the chrome around them.
 *
 * Surface ordering is part of the contract. Light themes step down:
 * surface > surface2 > surface3. Dark themes step up: surface < surface2 <
 * surface3. Borders sit above the surfaces they separate in both modes, and
 * each token carries the theme's tint instead of plain gray.
 *
 * Adding a theme: append a ThemeDefinition. The workspace's `themeCustom`
 * palette is its own theme id ("custom"): it layers over the default palette
 * and never masks a named theme.
 */

export interface ThemeDefinition {
  id: string;
  label: string;
  /** Key colors for readability in the picker. */
  swatch: { background: string; text: string; accent: string };
  variants: { light: ThemePaletteTokens | null; dark: ThemePaletteTokens };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "default",
    label: "Default",
    swatch: { background: "#ffffff", text: "#1f2328", accent: "#1e5aa0" },
    variants: {
      light: {
        surface: "#ffffff",
        surface2: "#f3f4f6",
        surface3: "#e9ebee",
        border: "#e5e7eb",
        borderStrong: "#d1d5db",
        text: "#1f2328",
        textSecondary: "#6b7280",
        accent: "#1e5aa0",
        accentSoft: "#e3edf8",
        danger: "#b42828",
        dangerSoft: "#f9e3e3",
        ok: "#2f6f4f",
        warning: "#96660f",
      },
      dark: {
        surface: "#1b1d21",
        surface2: "#24272c",
        surface3: "#2d3138",
        border: "#363b42",
        borderStrong: "#4a5058",
        text: "#e8eaed",
        textSecondary: "#9aa1aa",
        accent: "#6ea6e3",
        accentSoft: "#223349",
        danger: "#e08585",
        dangerSoft: "#4a2a2a",
        ok: "#7cc49d",
        warning: "#d3a54f",
      },
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    swatch: { background: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7" },
    variants: {
      light: {
        surface: "#eff1f5",
        surface2: "#e6e9ef",
        surface3: "#dce0e8",
        border: "#ccd0da",
        borderStrong: "#bcc0cc",
        text: "#4c4f69",
        textSecondary: "#6c6f85",
        accent: "#1e66f5",
        accentSoft: "#ccd0da",
        danger: "#d20f39",
        dangerSoft: "#f2d5dd",
        ok: "#40a02b",
        warning: "#df8e1d",
      },
      dark: {
        surface: "#1e1e2e",
        surface2: "#262636",
        surface3: "#313244",
        border: "#45475a",
        borderStrong: "#585b70",
        text: "#cdd6f4",
        textSecondary: "#a6adc8",
        accent: "#89b4fa",
        accentSoft: "#313244",
        danger: "#f38ba8",
        dangerSoft: "#453246",
        ok: "#a6e3a1",
        warning: "#f9e2af",
      },
    },
  },
  {
    id: "evergarden",
    label: "Evergarden",
    swatch: { background: "#232a2e", text: "#f8f9e8", accent: "#b3e6db" },
    variants: {
      light: {
        surface: "#f5efe6",
        surface2: "#f2eae1",
        surface3: "#e8ded5",
        border: "#d9d0c0",
        borderStrong: "#c3baa9",
        text: "#2b3034",
        textSecondary: "#455355",
        accent: "#8294ad",
        accentSoft: "#dde5e8",
        danger: "#c58687",
        dangerSoft: "#ecdcdd",
        ok: "#91a77a",
        warning: "#c4aa80",
      },
      dark: {
        surface: "#232a2e",
        surface2: "#2b3338",
        surface3: "#343e44",
        border: "#3d484d",
        borderStrong: "#4a585c",
        text: "#f8f9e8",
        textSecondary: "#adc9bc",
        accent: "#b3e6db",
        accentSoft: "#2b3a3c",
        danger: "#f57f82",
        dangerSoft: "#43262a",
        ok: "#cbe3b3",
        warning: "#f5d098",
      },
    },
  },
  {
    id: "melange",
    label: "Melange",
    swatch: { background: "#292522", text: "#ece1d7", accent: "#e49b5d" },
    variants: {
      light: {
        surface: "#f1f1f1",
        surface2: "#e9e1db",
        surface3: "#d9d3ce",
        border: "#c9c1ba",
        borderStrong: "#b0a69c",
        text: "#54433a",
        textSecondary: "#7d6658",
        accent: "#bc5c00",
        accentSoft: "#f3e0d2",
        danger: "#bf0021",
        dangerSoft: "#f5dcdc",
        ok: "#3a684a",
        warning: "#a06d00",
      },
      dark: {
        surface: "#292522",
        surface2: "#34302c",
        surface3: "#403a36",
        border: "#4a433d",
        borderStrong: "#5a5248",
        text: "#ece1d7",
        textSecondary: "#c1a78e",
        accent: "#e49b5d",
        accentSoft: "#40342b",
        danger: "#d47766",
        dangerSoft: "#452e2b",
        ok: "#85b695",
        warning: "#ebc06d",
      },
    },
  },
  {
    id: "nord",
    label: "Nord",
    swatch: { background: "#2e3440", text: "#d8dee9", accent: "#88c0d0" },
    variants: {
      light: {
        surface: "#eceff4",
        surface2: "#e5e9f0",
        surface3: "#d8dee9",
        border: "#c9d1de",
        borderStrong: "#b3bdd0",
        text: "#2e3440",
        textSecondary: "#5c6675",
        accent: "#4783a0",
        accentSoft: "#dce7ee",
        danger: "#bf616a",
        dangerSoft: "#f0dee0",
        ok: "#5f8a6e",
        warning: "#a3813f",
      },
      dark: {
        surface: "#2e3440",
        surface2: "#3b4252",
        surface3: "#434c5e",
        border: "#4c566a",
        borderStrong: "#5f6b82",
        text: "#eceff4",
        textSecondary: "#a3b1c6",
        accent: "#88c0d0",
        accentSoft: "#3b4a5c",
        danger: "#bf616a",
        dangerSoft: "#4c3a3e",
        ok: "#a3be8c",
        warning: "#ebcb8b",
      },
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    swatch: { background: "#282828", text: "#ebdbb2", accent: "#83a598" },
    variants: {
      light: {
        surface: "#fbf1c7",
        surface2: "#f2e5bc",
        surface3: "#ebdbb2",
        border: "#d5c4a1",
        borderStrong: "#bdae93",
        text: "#3c3836",
        textSecondary: "#7c6f64",
        accent: "#79740e",
        accentSoft: "#e8dfa9",
        danger: "#9d0006",
        dangerSoft: "#f0c9c9",
        ok: "#79740e",
        warning: "#b57614",
      },
      dark: {
        surface: "#282828",
        surface2: "#32302f",
        surface3: "#3c3836",
        border: "#504945",
        borderStrong: "#665c54",
        text: "#ebdbb2",
        textSecondary: "#a89984",
        accent: "#83a598",
        accentSoft: "#3e4a4d",
        danger: "#fb4934",
        dangerSoft: "#4c3634",
        ok: "#b8bb26",
        warning: "#fabd2f",
      },
    },
  },
];

/** The "custom" theme id: merges the workspace palette over the default. */
export const CUSTOM_THEME_ID = "custom";

export function themeById(id: string): ThemeDefinition | undefined {
  return THEMES.find((theme) => theme.id === id);
}

export interface ResolvedTheme {
  /** Effective token map (custom overrides merged in). */
  palette: ThemePaletteTokens;
  /** Which CSS variant / renderer palette applies. */
  mode: "light" | "dark";
  /** The underlying definition, null for pure-custom. */
  definition: ThemeDefinition | null;
}

/**
 * Light palette for documents meant to be read on white or printed: uses the
 * active theme's light variant when it has one, else the default theme's light
 * variant. Custom overrides still apply, so a custom palette keeps its colors
 * rather than silently reverting to the named theme.
 */
export function resolveLightTheme(settings: {
  theme: ThemeMode;
  themeName?: string;
  themeCustom?: ThemePaletteTokens | null;
}): ResolvedTheme {
  const def = themeById(settings.themeName ?? "default") ?? null;
  const fallback = THEMES[0]!;
  const base = def?.variants.light ?? fallback.variants.light ?? fallback.variants.dark;
  const custom = settings.themeName === CUSTOM_THEME_ID || !def ? (settings.themeCustom ?? {}) : {};

  return {
    palette: { ...base, ...custom },
    mode: "light",
    definition: def,
  };
}

/**
 * Resolves a theme + mode into concrete tokens.
 * - "custom" merges settings.themeCustom over the default palette; named
 *   themes ignore a leftover custom palette so switching back and forth does
 *   not silently mask them.
 * - a theme without a light variant stays dark even in light mode.
 * - "auto" follows the OS preference.
 */
export function resolveTheme(settings: {
  theme: ThemeMode;
  themeName?: string;
  themeCustom?: ThemePaletteTokens | null;
}): ResolvedTheme {
  const preferDark =
    settings.theme === "dark" || (settings.theme === "auto" && prefersDarkScheme());

  const def = themeById(settings.themeName ?? "default") ?? null;
  let base: ThemePaletteTokens;
  let mode: "light" | "dark";

  if (!def) {
    // Pure custom (or unknown id): use the default palette, flipped by mode.
    const fallback = THEMES[0]!;
    mode = preferDark ? "dark" : "light";
    base =
      mode === "dark"
        ? fallback.variants.dark
        : (fallback.variants.light ?? fallback.variants.dark);
  } else if (preferDark || !def.variants.light) {
    base = def.variants.dark;
    mode = "dark";
  } else {
    base = def.variants.light;
    mode = "light";
  }

  const custom = settings.themeName === CUSTOM_THEME_ID || !def ? (settings.themeCustom ?? {}) : {};

  return {
    palette: { ...base, ...custom },
    mode,
    definition: def,
  };
}

function prefersDarkScheme(): boolean {
  return (
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

/** The workspace font settings that also drive the app chrome. */
export interface AppFontSettings {
  font?: string | null;
  mathFont?: string | null;
  codeFont?: string | null;
}

function cssFamily(family: string): string {
  // Family names are user data; quote and escape so a stray quote cannot
  // break the declaration.
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** CSS font stacks for the chrome, mirroring the renderer's font settings. */
export function fontStacks(settings: AppFontSettings): {
  sans: string;
  mono: string;
  math: string;
} {
  const text = settings.font?.trim();
  const code = settings.codeFont?.trim() || text;
  const math = settings.mathFont?.trim() || text;
  const family = (value?: string) => (value ? cssFamily(value) : null);
  const join = (...parts: Array<string | null>) =>
    parts.filter((part): part is string => !!part).join(", ");

  return {
    sans: join(family(text), "ui-sans-serif", "system-ui", "sans-serif"),
    mono: join(family(code), "ui-monospace", "SFMono-Regular", "Menlo", "monospace"),
    math: join(family(math), family("New Computer Modern Math"), "serif"),
  };
}

/** Token key to CSS custom property: `surface2` -> `--color-surface-2`. */
export function themeCssVar(token: string): string {
  return `--color-${token.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase()}`;
}

/** Applies the resolved tokens to <html> (CSS custom properties + data attrs). */
export function applyThemeToDom(resolved: ResolvedTheme, fonts?: AppFontSettings): void {
  const root = document.documentElement;
  root.dataset.theme = resolved.mode;
  root.dataset.themeName = resolved.definition?.id ?? "custom";
  root.style.colorScheme = resolved.mode;
  // Token keys are camelCase (`surface2`); the stylesheets read kebab-case
  // (`--color-surface-2`). Without the conversion the multiword tokens never
  // reached the DOM and themes fell back to the default palette.
  for (const [token, value] of Object.entries(resolved.palette)) {
    root.style.setProperty(themeCssVar(token), value);
  }

  // The chrome follows the workspace's text/math/code fonts.
  if (fonts?.font) {
    const stacks = fontStacks(fonts);
    root.style.setProperty("--font-sans", stacks.sans);
    root.style.setProperty("--font-mono", stacks.mono);
    root.style.setProperty("--font-math", stacks.math);
  }
}

// Last-applied settings cache. Workspace theme settings live in a Loro doc,
// which is async and boot-time-slow; painting the correct palette on page
// load needs it earlier. Every apply writes the settings here, and a client
// plugin restores them before the first app frame.

const THEME_CACHE_KEY = "typbase:themeCache";

type CachedThemeSettings = Parameters<typeof resolveTheme>[0] & AppFontSettings;

export function cacheThemeSettings(settings: CachedThemeSettings): void {
  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        theme: settings.theme ?? "auto",
        themeName: settings.themeName ?? "default",
        themeCustom: settings.themeCustom ?? null,
        font: settings.font ?? null,
        mathFont: settings.mathFont ?? null,
        codeFont: settings.codeFont ?? null,
      } satisfies CachedThemeSettings),
    );
  } catch {
    // Storage can be unavailable; the workspace apply still runs later.
  }
}

/** Pre-paint restore: tokens land before the first app frame. */
export function restoreCachedTheme(): void {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return;

    const cached = JSON.parse(raw) as CachedThemeSettings;
    if (!cached.theme) return;

    applyThemeToDom(resolveTheme(cached), cached);
  } catch {
    // Corrupt cache: fall back to the defaults in main.css.
  }
}

// Renderer palette derivation: the Typst theme is built from the same tokens,
// so a custom theme automatically gets matching rendered pages. The color math
// lives in ./palette so plugin workers can share it without wasm or the theme
// registry.
export function rendererColors(palette: ThemePaletteTokens): ThemeColors {
  return themeColorsFromPalette(palette);
}

export function rendererPaletteFor(resolved: ResolvedTheme): ThemeColors {
  return rendererColors(resolved.palette);
}
