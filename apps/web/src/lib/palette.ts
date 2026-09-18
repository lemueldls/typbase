import type { ThemePaletteTokens } from "@typbase/typing";

/**
 * Pure color math for the app palette and the Typst renderer dictionary. Kept
 * free of wasm and DOM so plugin workers can use it without pulling in the
 * theme registry.
 */

export type RgbTriple = [number, number, number];

/**
 * `ThemeColors` slots in constructor order, named the way Typst reads them.
 * The order here is the contract between the Rust struct and paletteSlots.
 */
export const THEME_COLOR_KEYS = [
  "surface",
  "surface-2",
  "surface-3",
  "border",
  "border-strong",
  "text",
  "text-secondary",
  "accent",
  "accent-soft",
  "on-accent",
  "ok",
  "warning",
  "danger",
  "danger-soft",
  "on-danger",
] as const;

function parseColor(css: string): RgbTriple {
  const match = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!match) return [127, 127, 127];

  const hex = match[1]!;

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: RgbTriple): number {
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
}

/** Prefer the page background as "on <color>" text when it reads well. */
function onColor(accent: RgbTriple, background: RgbTriple): RgbTriple {
  return luminance(accent) > 0.45 ? [...background] : [255, 255, 255];
}

/**
 * The 15 `ThemeColors` slots in constructor order. Callers wrap each triple in
 * a fresh wasm Rgb; wasm-bindgen moves those, so instances can never be
 * shared.
 */
export function paletteSlots(palette: ThemePaletteTokens): RgbTriple[] {
  const surface = parseColor(palette.surface);
  const accent = parseColor(palette.accent);
  const danger = parseColor(palette.danger);

  return [
    surface,
    parseColor(palette.surface2),
    parseColor(palette.surface3),

    parseColor(palette.border),
    parseColor(palette.borderStrong),

    parseColor(palette.text),
    parseColor(palette.textSecondary),

    accent,
    parseColor(palette.accentSoft),
    onColor(accent, surface),

    parseColor(palette.ok),
    parseColor(palette.warning),

    danger,
    parseColor(palette.dangerSoft),
    onColor(danger, surface),
  ];
}

/**
 * The palette as a Typst dictionary literal. Same keys the wasm `Display`
 * emits, for the publish prelude where there is no live typst state yet.
 */
export function typstThemeDict(palette: ThemePaletteTokens): string {
  const slots = paletteSlots(palette);
  const entries = THEME_COLOR_KEYS.map((key, index) => `${key}:rgb(${slots[index]!.join(",")})`);

  return `(${entries.join(",")})`;
}
