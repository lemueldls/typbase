import type { ThemePaletteTokens } from "@typbase/typing";

import { Rgb, ThemeColors } from "@typbase/wasm";

import { paletteSlots } from "./palette";

/**
 * Wraps the pure palette triples in wasm instances. Every slot gets its OWN
 * Rgb: wasm-bindgen moves each argument into the native side, so aliasing one
 * instance (say, `text` for every on_*_container slot) throws "Attempt to use
 * a moved value".
 */
export function themeColorsFromPalette(palette: ThemePaletteTokens): ThemeColors {
  const c = paletteSlots(palette).map(([r, g, b]) => new Rgb(r, g, b));

  return new ThemeColors(
    c[0]!,
    c[1]!,
    c[2]!,
    c[3]!,
    c[4]!,
    c[5]!,
    c[6]!,
    c[7]!,
    c[8]!,
    c[9]!,
    c[10]!,
    c[11]!,
    c[12]!,
    c[13]!,
    c[14]!,
    c[15]!,
    c[16]!,
    c[17]!,
    c[18]!,
    c[19]!,
  );
}
