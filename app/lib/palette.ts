import type { ThemePaletteTokens } from "@typbase/typing";

/**
 * Pure color math for deriving the Typst renderer palette. Kept free of wasm
 * and DOM so plugin workers can use it without pulling in the theme registry.
 */

export type RgbTriple = [number, number, number];

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

/** Prefer the page background as "on <accent>" text when it reads well. */
function onColor(accent: RgbTriple, background: RgbTriple): RgbTriple {
  return luminance(accent) > 0.45 ? [...background] : [255, 255, 255];
}

/**
 * The 20 ThemeColors slots in constructor order: background, primary,
 * secondary, tertiary, and error groups. Callers wrap each triple in a fresh
 * wasm Rgb; wasm-bindgen moves those, so instances can never be shared.
 */
export function paletteSlots(palette: ThemePaletteTokens): RgbTriple[] {
  const background = parseColor(palette.surface);
  const primary = parseColor(palette.accent);
  const secondary = parseColor(palette.ok);
  const tertiary = parseColor(palette.warning);
  const error = parseColor(palette.danger);
  const text = () => parseColor(palette.text);

  return [
    // background group; the outline variant is the lighter surface
    background,
    text(),
    parseColor(palette.border),
    parseColor(palette.surface3),
    // primary group (soft containers keep text readable on them)
    primary,
    onColor(primary, background),
    parseColor(palette.accentSoft),
    text(),
    // secondary group
    secondary,
    onColor(secondary, background),
    parseColor(palette.ok),
    text(),
    // tertiary group
    tertiary,
    onColor(tertiary, background),
    parseColor(palette.warning),
    text(),
    // error group
    error,
    onColor(error, background),
    parseColor(palette.dangerSoft),
    text(),
  ];
}
