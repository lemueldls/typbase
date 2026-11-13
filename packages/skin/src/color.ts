import type { ThemePaletteTokens, ThemeSeeds } from "@typbase/typing";

export type RgbTriple = [number, number, number];

/** How much of a solid color goes into its soft background. */
const SOFT_MIX = 0.12;

const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
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

function expandHex(hex: string): string {
  if (hex.length === 3 || hex.length === 4) {
    return hex
      .split("")
      .map((digit) => digit + digit)
      .join("");
  }

  return hex;
}

/**
 * Canonical hex for a color string. The palette editor and the Typst palette
 * parser both read hex, so normalizing here keeps the two in step. Returns the
 * trimmed input when the syntax is not one we can convert.
 */
export function normalizeCssColor(value: string): string {
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) {
    const raw = expandHex(trimmed.slice(1)).toLowerCase();

    return `#${raw}`;
  }

  const match = RGB_FUNCTION.exec(trimmed);
  if (!match) return trimmed;

  const alpha = alphaChannel(match[4]);

  return `#${[match[1]!, match[2]!, match[3]!]
    .map((part) => channel(part).toString(16).padStart(2, "0"))
    .join("")}${alpha === 255 ? "" : alpha.toString(16).padStart(2, "0")}`;
}

/** True for a color string the renderer can read after normalization. */
export function isRenderableColor(value: string): boolean {
  const normalized = normalizeCssColor(value);

  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(normalized);
}

export function parseColor(css: string): RgbTriple {
  const normalized = normalizeCssColor(css);
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(normalized);
  if (!match) return [127, 127, 127];

  const hex = match[1]!;

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** `weight` is the share of `color`. The rest comes from `base`. */
export function mixHex(color: string, base: string, weight: number): string {
  const [cr, cg, cb] = parseColor(color);
  const [br, bg, bb] = parseColor(base);
  const mix = (a: number, b: number) => Math.round(a * weight + b * (1 - weight));

  return `#${[mix(cr, br), mix(cg, bg), mix(cb, bb)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Turns the seeds a theme author writes into the full token map the app
 * consumes: soft backgrounds are mixed from the solids and overlay follows the
 * mode.
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
    overlay: mode === "dark" ? "#0000008c" : "#00000059",
  };
}

export function relativeLuminance([r, g, b]: RgbTriple): number {
  const linear = (component: number) => {
    const value = component / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two color strings. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseColor(foreground));
  const b = relativeLuminance(parseColor(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Prefer the background as "on <color>" text when it reads well. */
export function readableOn(accent: string, background: string): string {
  const luminance = relativeLuminance(parseColor(accent));

  return luminance > 0.45 ? normalizeCssColor(background) : "#ffffff";
}

/** Swatches a theme card or registry page can render without extra data. */
export function previewPalette(
  palette: ThemePaletteTokens,
  mode: "light" | "dark",
): {
  mode: "light" | "dark";
  surface: string;
  surface2: string;
  surface3: string;
  text: string;
  accent: string;
  code: string;
} {
  return {
    mode,
    surface: palette.surface,
    surface2: palette.surface2,
    surface3: palette.surface3,
    text: palette.text,
    accent: palette.accent,
    code: palette.code,
  };
}
