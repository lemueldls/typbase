import type { ThemePaletteTokens, ThemeSeeds } from "@typbase/typing";

/**
 * Pure color math for the app palette and the Typst renderer dictionary. Kept
 * free of wasm and DOM so plugin workers can use it without pulling in the
 * theme registry.
 */

export type RgbTriple = [number, number, number];

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

/** How much of a solid color goes into its soft background. */
const SOFT_MIX = 0.12;

function parseColor(css: string): RgbTriple {
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(css.trim());
  if (!match) return [127, 127, 127];

  const hex = match[1]!;

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const RGB_FUNCTION =
  /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

function channel(value: string): number {
  const number = value.endsWith("%") ? (Number.parseFloat(value) / 100) * 255 : Number(value);

  return Math.max(0, Math.min(255, Math.round(number)));
}

function alphaChannel(value: string | undefined): number {
  if (value === undefined) return 255;
  const number = value.endsWith("%") ? Number.parseFloat(value) / 100 : Number.parseFloat(value);

  return Math.max(0, Math.min(255, Math.round(number * 255)));
}

/**
 * Canonical hex for a color string. The palette editor (reka's ColorField)
 * parses hex and comma rgb(), but not `rgb(r g b / a)`, and the renderer
 * palette parser only reads hex; normalizing here keeps both happy.
 */
export function normalizeCssColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) return trimmed.toLowerCase();

  // Expand #rgb / #rgba so the renderer palette parser can read them too.
  if (/^#[0-9a-f]{3,4}$/i.test(trimmed)) {
    const hex = trimmed
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("");

    return `#${hex.toLowerCase()}`;
  }

  const match = RGB_FUNCTION.exec(trimmed);
  if (!match) return trimmed;

  const alpha = alphaChannel(match[4]);

  return `#${[match[1]!, match[2]!, match[3]!]
    .map((part) => channel(part).toString(16).padStart(2, "0"))
    .join("")}${alpha === 255 ? "" : alpha.toString(16).padStart(2, "0")}`;
}

/** `weight` is the share of `color`; the rest comes from `base`. */
function mixHex(color: string, base: string, weight: number): string {
  const [cr, cg, cb] = parseColor(color);
  const [br, bg, bb] = parseColor(base);
  const mix = (a: number, b: number) => Math.round(a * weight + b * (1 - weight));

  return `#${[mix(cr, br), mix(cg, bg), mix(cb, bb)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Turns the seeds a theme author writes into the full token map the app
 * consumes: soft backgrounds are mixed from the solids, overlay follows the
 * mode, and on-* text stays derived at the renderer slot boundary.
 */
export function expandSeeds(seeds: ThemeSeeds, mode: "light" | "dark"): ThemePaletteTokens {
  const soft = (color: string) => mixHex(color, seeds.surface, SOFT_MIX);

  return {
    ...seeds,
    accentSoft: soft(seeds.accent),
    okSoft: soft(seeds.ok),
    warningSoft: soft(seeds.warning),
    dangerSoft: soft(seeds.danger),
    infoSoft: soft(seeds.info),
    // Hex with alpha: reka's ColorField (the palette editor) parses hex8 but
    // not the `rgb(r g b / a)` syntax.
    overlay: mode === "dark" ? "#0000008c" : "#00000059",
  };
}

function luminance([r, g, b]: RgbTriple): number {
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
}

/** Prefer the page background as "on <color>" text when it reads well. */
function onColor(accent: RgbTriple, background: RgbTriple): RgbTriple {
  return luminance(accent) > 0.45 ? [...background] : [255, 255, 255];
}

/**
 * The `ThemeColors` slots in constructor order. Callers wrap each triple in a
 * fresh wasm Rgb; wasm-bindgen moves those, so instances can never be shared.
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
    parseColor(palette.okSoft),

    parseColor(palette.warning),
    parseColor(palette.warningSoft),

    danger,
    parseColor(palette.dangerSoft),
    onColor(danger, surface),

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
