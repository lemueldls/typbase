import type { ThemePaletteTokens } from "@typbase/typing";

import { parseColor, readableOn, type RgbTriple } from "@typbase/skin";

export { expandSeeds, mixHex, normalizeCssColor, parseColor, type RgbTriple } from "@typbase/skin";

/**
 * `ThemeColors` slots in constructor order, named the way Typst reads them.
 * The order here is the contract between the Rust struct and paletteSlots.
 * `overlay` is chrome-only (it carries alpha), so it is not a renderer slot.
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
  "ok-soft",
  "warning",
  "warning-soft",
  "danger",
  "danger-soft",
  "on-danger",
  "info",
  "info-soft",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "code",
] as const;

/**
 * The `ThemeColors` slots in constructor order. Callers wrap each triple in a
 * fresh wasm Rgb, and wasm-bindgen moves those, so instances can never be shared.
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
    parseColor(readableOn(palette.accent, palette.surface)),

    parseColor(palette.ok),
    parseColor(palette.okSoft),

    parseColor(palette.warning),
    parseColor(palette.warningSoft),

    danger,
    parseColor(palette.dangerSoft),
    parseColor(readableOn(palette.danger, palette.surface)),

    parseColor(palette.info),
    parseColor(palette.infoSoft),

    parseColor(palette.red),
    parseColor(palette.orange),
    parseColor(palette.yellow),
    parseColor(palette.green),
    parseColor(palette.cyan),
    parseColor(palette.blue),
    parseColor(palette.violet),

    parseColor(palette.code),
  ];
}
