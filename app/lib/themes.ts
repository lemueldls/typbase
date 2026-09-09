import type { ThemeMode, ThemePaletteTokens } from "@typbase/typing";

import { Rgb, ThemeColors } from "@typbase/wasm";

/**
 * Theme registry. A theme is pure data: a token map for the app chrome plus
 * a light/dark classification, and the Typst renderer palette is derived
 * from the same tokens so published pages match the chrome around them.
 *
 * Adding a theme: append a ThemeDefinition. Custom palettes (workspace
 * setting `themeCustom`) merge over the selected theme, so user themes only
 * need the tokens they differ on.
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
        surface2: "#181825",
        surface3: "#11111b",
        border: "#313244",
        borderStrong: "#45475a",
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
        border: "#e6e1d3",
        borderStrong: "#ceccbd",
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
        surface2: "#1c2225",
        surface3: "#171c1f",
        border: "#374145",
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
        border: "#3e3833",
        borderStrong: "#554e46",
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
 * Resolves a theme + mode into concrete tokens.
 * - custom tokens (settings.themeCustom) merge over the selected theme.
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

  return {
    palette: { ...base, ...(settings.themeCustom ?? {}) },
    mode,
    definition: def,
  };
}

function prefersDarkScheme(): boolean {
  return (
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

/** Applies the resolved tokens to <html> (CSS custom properties + data attrs). */
export function applyThemeToDom(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = resolved.mode;
  root.dataset.themeName = resolved.definition?.id ?? "custom";
  root.style.colorScheme = resolved.mode;
  const cssVar = (token: string) => `--color-${token}`;
  for (const [token, value] of Object.entries(resolved.palette)) {
    root.style.setProperty(cssVar(token), value);
  }
}

// Last-applied settings cache. Workspace theme settings live in a Loro doc,
// which is async and boot-time-slow; painting the correct palette on page
// load needs it earlier. Every apply writes the settings here, and a client
// plugin restores them before the first app frame.

const THEME_CACHE_KEY = "typbase:themeCache";

export function cacheThemeSettings(settings: Parameters<typeof resolveTheme>[0]): void {
  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        theme: settings.theme ?? "auto",
        themeName: settings.themeName ?? "default",
        themeCustom: settings.themeCustom ?? null,
      }),
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

    const cached = JSON.parse(raw) as Parameters<typeof resolveTheme>[0];
    if (!cached.theme) return;

    applyThemeToDom(resolveTheme(cached));
  } catch {
    // Corrupt cache: fall back to the defaults in main.css.
  }
}

// Renderer palette derivation: the Typst theme is built from the same tokens,
// so a custom theme automatically gets matching rendered pages. Contrast
// colors are computed from the chrome surfaces rather than hardcoded.

function rgba(css: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!match) return new Rgb(127, 127, 127);

  const hex = match[1]!;
  return new Rgb(
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  );
}

/** The wasm Rgb class exposes no fields; parse its `rgb(r,g,b)` string form. */
function rgbChannels(rgb: Rgb): [number, number, number] {
  const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(rgb.toString());
  if (!match) return [127, 127, 127];

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgbChannels(rgb);
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
}

/** Fresh copy of an Rgb; wasm-bindgen consumes (moves) instances, so the
 * same wrapper can never appear in two slots of a constructor call. */
function copyOf(rgb: Rgb): Rgb {
  const [r, g, b] = rgbChannels(rgb);
  return new Rgb(r, g, b);
}

/** Prefer the page background as "on <accent>" text when it reads well.
 * Returns a NEW instance: the caller may consume both operands. */
function onColor(accent: Rgb, background: Rgb): Rgb {
  return luminance(accent) > 0.45 ? copyOf(background) : new Rgb(255, 255, 255);
}

/** Derives the 20-slot Typst ThemeColors from chrome tokens. Every slot gets
 * its OWN Rgb instance: wasm-bindgen moves each argument into the native
 * side, so aliasing one instance (say, `text` for every on_*_container slot)
 * throws "Attempt to use a moved value". */
export function rendererColors(palette: ThemePaletteTokens): ThemeColors {
  const background = rgba(palette.surface);
  const border = rgba(palette.border);
  const soft = rgba(palette.surface3);
  const primary = rgba(palette.accent);
  const secondary = rgba(palette.ok);
  const tertiary = rgba(palette.warning);
  const error = rgba(palette.danger);

  const textFor = () => rgba(palette.text);

  return new ThemeColors(
    // background group; the outline variant is the lighter surface
    background,
    textFor(),
    border,
    soft,
    // primary group (soft containers keep text readable on them)
    primary,
    onColor(primary, background),
    rgba(palette.accentSoft),
    textFor(),
    // secondary group
    secondary,
    onColor(secondary, background),
    rgba(palette.ok),
    textFor(),
    // tertiary group
    tertiary,
    onColor(tertiary, background),
    rgba(palette.warning),
    textFor(),
    // error group
    error,
    onColor(error, background),
    rgba(palette.dangerSoft),
    textFor(),
  );
}

export function rendererPaletteFor(resolved: ResolvedTheme): ThemeColors {
  return rendererColors(resolved.palette);
}
