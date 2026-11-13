import type {
  CustomThemePalettes,
  ThemePaletteTokens,
  UiDensity,
  UiRadius,
  UiSize,
  WorkspaceSettings,
} from "@typbase/typing";

import { THEME_PALETTE_TOKEN_KEYS } from "@typbase/typing";

import {
  contrastRatio,
  isRenderableColor,
  mixHex,
  normalizeCssColor,
  parseColor,
  relativeLuminance,
} from "./color";

export const SKIN_SCHEMA_VERSION = "typbase.skin.v1" as const;
export const THEME_FILE_SCHEMA = "typbase.theme.v1" as const;

export type SkinSchemaVersion = typeof SKIN_SCHEMA_VERSION;

export const UI_SIZES: readonly UiSize[] = ["small", "default", "large"];
export const UI_DENSITIES: readonly UiDensity[] = ["compact", "default", "spacious"];
export const UI_RADII: readonly UiRadius[] = ["square", "default", "round"];
export interface SkinGeometry {
  size: UiSize;
  density: UiDensity;
  radius: UiRadius;
}

export interface SkinTypography {
  font: string;
  mathFont: string | null;
  codeFont: string | null;
  /** Body text size in pt. */
  textSize: number;
  ligatures: boolean;
  kerning: boolean;
}

/**
 * A complete skin. Published themes include this object in a release record.
 * It is resolved data: both palettes are explicit, so applying a theme does
 * not depend on the app's named-theme registry.
 */
export interface Skin {
  schema: SkinSchemaVersion;
  palette: CustomThemePalettes;
  geometry: SkinGeometry;
  typography: SkinTypography;
}

export interface ThemeFile {
  schema: typeof THEME_FILE_SCHEMA;
  name: string;
  description?: string;
  license?: string;
  tags?: string[];
  forkedFrom?: string;
  skin: Skin;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ContrastWarning {
  path: string;
  pair: string;
  ratio: number;
  minimum: number;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  errors: ValidationIssue[];
  warnings: ContrastWarning[];
}

const SKIN_KEYS = ["schema", "palette", "geometry", "typography"] as const;
const GEOMETRY_KEYS = ["size", "density", "radius"] as const;
const TYPOGRAPHY_KEYS = [
  "font",
  "mathFont",
  "codeFont",
  "textSize",
  "ligatures",
  "kerning",
] as const;
const THEME_FILE_KEYS = [
  "$schema",
  "schema",
  "name",
  "description",
  "license",
  "tags",
  "forkedFrom",
  "skin",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ path: path ? `${path}.${key}` : key, message: "unknown field" });
    }
  }
}

function stringValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  options: { max?: number; allowEmpty?: boolean } = {},
): string | null {
  if (typeof value !== "string") {
    errors.push({ path, message: "must be a string" });

    return null;
  }
  if (!options.allowEmpty && !value.trim()) {
    errors.push({ path, message: "must not be empty" });

    return null;
  }
  if (options.max && value.length > options.max) {
    errors.push({ path, message: `must be at most ${options.max} characters` });
  }

  return value;
}

function nullableString(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  max: number,
): string | null {
  if (value === null) return null;

  return stringValue(value, path, errors, { max });
}

function numberValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ path, message: "must be a finite number" });

    return null;
  }
  if (value < min || value > max) {
    errors.push({ path, message: `must be between ${min} and ${max}` });
  }

  return value;
}

function booleanValue(value: unknown, path: string, errors: ValidationIssue[]): boolean | null {
  if (typeof value !== "boolean") {
    errors.push({ path, message: "must be a boolean" });

    return null;
  }

  return value;
}

function colorValue(value: unknown, path: string, errors: ValidationIssue[]): string | null {
  const raw = stringValue(value, path, errors);
  if (raw === null) return null;
  const normalized = normalizeCssColor(raw);
  if (!isRenderableColor(normalized)) {
    errors.push({ path, message: "must be a hex or rgb() color" });

    return null;
  }

  return normalized;
}

function paletteValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): ThemePaletteTokens | null {
  if (!isRecord(value)) {
    errors.push({ path, message: "must be an object" });

    return null;
  }

  unknownKeys(value, THEME_PALETTE_TOKEN_KEYS, path, errors);
  const palette = {} as ThemePaletteTokens;
  let ok = true;
  for (const key of THEME_PALETTE_TOKEN_KEYS) {
    const color = colorValue(value[key], `${path}.${key}`, errors);
    if (color === null) ok = false;
    else palette[key] = color;
  }

  return ok ? palette : null;
}

function geometryValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): SkinGeometry | null {
  if (!isRecord(value)) {
    errors.push({ path, message: "must be an object" });

    return null;
  }

  unknownKeys(value, GEOMETRY_KEYS, path, errors);
  const size = value.size;
  const density = value.density;
  const radius = value.radius;
  if (typeof size !== "string" || !UI_SIZES.includes(size as UiSize)) {
    errors.push({ path: `${path}.size`, message: "must be small, default, or large" });
  }
  if (typeof density !== "string" || !UI_DENSITIES.includes(density as UiDensity)) {
    errors.push({
      path: `${path}.density`,
      message: "must be compact, default, or spacious",
    });
  }
  if (typeof radius !== "string" || !UI_RADII.includes(radius as UiRadius)) {
    errors.push({ path: `${path}.radius`, message: "must be square, default, or round" });
  }
  if (
    typeof size !== "string" ||
    !UI_SIZES.includes(size as UiSize) ||
    typeof density !== "string" ||
    !UI_DENSITIES.includes(density as UiDensity) ||
    typeof radius !== "string" ||
    !UI_RADII.includes(radius as UiRadius)
  ) {
    return null;
  }

  return { size: size as UiSize, density: density as UiDensity, radius: radius as UiRadius };
}

function typographyValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): SkinTypography | null {
  if (!isRecord(value)) {
    errors.push({ path, message: "must be an object" });

    return null;
  }

  unknownKeys(value, TYPOGRAPHY_KEYS, path, errors);
  const font = stringValue(value.font, `${path}.font`, errors, { max: 200 });
  const mathFont = nullableString(value.mathFont, `${path}.mathFont`, errors, 200);
  const codeFont = nullableString(value.codeFont, `${path}.codeFont`, errors, 200);
  const textSize = numberValue(value.textSize, `${path}.textSize`, errors, 8, 32);
  const ligatures = booleanValue(value.ligatures, `${path}.ligatures`, errors);
  const kerning = booleanValue(value.kerning, `${path}.kerning`, errors);

  if (
    font === null ||
    textSize === null ||
    ligatures === null ||
    kerning === null ||
    (value.mathFont !== null && mathFont === null) ||
    (value.codeFont !== null && codeFont === null)
  ) {
    return null;
  }

  return { font, mathFont, codeFont, textSize, ligatures, kerning };
}

function contrastWarningsFor(palette: ThemePaletteTokens, path: string): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  const check = (name: string, foreground: string, background: string, minimum: number) => {
    const ratio = contrastRatio(foreground, background);
    if (ratio + 0.001 < minimum) {
      warnings.push({
        path,
        pair: name,
        ratio: Math.round(ratio * 100) / 100,
        minimum,
        message: `${name} contrast is ${ratio.toFixed(2)}:1, below ${minimum}:1`,
      });
    }
  };

  check("text on surface", palette.text, palette.surface, 4.5);
  check("secondary text on surface", palette.textSecondary, palette.surface, 4.5);
  check("accent on surface", palette.accent, palette.surface, 3);

  return warnings;
}

/** Validates a complete skin object without throwing. */
export function validateSkin(raw: unknown): ValidationResult<Skin> {
  const errors: ValidationIssue[] = [];
  const warnings: ContrastWarning[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      value: null,
      errors: [{ path: "", message: "skin must be an object" }],
      warnings,
    };
  }

  unknownKeys(raw, SKIN_KEYS, "", errors);
  if (raw.schema !== SKIN_SCHEMA_VERSION) {
    errors.push({
      path: "schema",
      message: `unsupported skin schema "${String(raw.schema)}" (need ${SKIN_SCHEMA_VERSION})`,
    });
  }

  const paletteRaw = raw.palette;
  let palette: CustomThemePalettes | null = null;
  if (!isRecord(paletteRaw)) {
    errors.push({ path: "palette", message: "must be an object" });
  } else {
    const light = paletteValue(paletteRaw.light, "palette.light", errors);
    const dark = paletteValue(paletteRaw.dark, "palette.dark", errors);
    if (light && dark) {
      palette = { light, dark };
      warnings.push(...contrastWarningsFor(light, "palette.light"));
      warnings.push(...contrastWarningsFor(dark, "palette.dark"));
    }
  }

  const geometry = geometryValue(raw.geometry, "geometry", errors);
  const typography = typographyValue(raw.typography, "typography", errors);

  if (errors.length || !palette || !geometry || !typography) {
    return { ok: false, value: null, errors, warnings };
  }

  return {
    ok: true,
    value: {
      schema: SKIN_SCHEMA_VERSION,
      palette,
      geometry,
      typography,
    },
    errors,
    warnings,
  };
}

export function parseSkin(raw: unknown): Skin {
  const result = validateSkin(raw);
  if (!result.ok || !result.value) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  return result.value;
}

/** Validates the authoring file used by the app, CLI, and templates. */
export function validateThemeFile(raw: unknown): ValidationResult<ThemeFile> {
  const errors: ValidationIssue[] = [];
  const warnings: ContrastWarning[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      value: null,
      errors: [{ path: "", message: "theme file must be an object" }],
      warnings,
    };
  }

  unknownKeys(raw, THEME_FILE_KEYS, "", errors);
  if (raw.schema !== THEME_FILE_SCHEMA) {
    errors.push({
      path: "schema",
      message: `unsupported theme file schema "${String(raw.schema)}" (need ${THEME_FILE_SCHEMA})`,
    });
  }

  const name = stringValue(raw.name, "name", errors, { max: 200 });
  const description =
    raw.description === undefined
      ? undefined
      : stringValue(raw.description, "description", errors, { max: 2000, allowEmpty: true });
  const license =
    raw.license === undefined
      ? undefined
      : stringValue(raw.license, "license", errors, { max: 100, allowEmpty: true });
  const forkedFrom =
    raw.forkedFrom === undefined
      ? undefined
      : stringValue(raw.forkedFrom, "forkedFrom", errors, { max: 2000 });

  let tags: string[] | undefined;
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push({ path: "tags", message: "must be a list" });
    } else {
      tags = [];
      for (const [index, tag] of raw.tags.entries()) {
        const value = stringValue(tag, `tags[${index}]`, errors, { max: 40 });
        if (value !== null) tags.push(value);
      }
      if (tags.length > 12) errors.push({ path: "tags", message: "must have at most 12 entries" });
    }
  }

  const skinResult = validateSkin(raw.skin);
  errors.push(...skinResult.errors.map((error) => ({ ...error, path: `skin.${error.path}` })));
  warnings.push(
    ...skinResult.warnings.map((warning) => ({ ...warning, path: `skin.${warning.path}` })),
  );

  if (errors.length || !skinResult.value || name === null) {
    return { ok: false, value: null, errors, warnings };
  }

  return {
    ok: true,
    value: {
      schema: THEME_FILE_SCHEMA,
      name,
      ...(description ? { description } : {}),
      ...(license ? { license } : {}),
      ...(tags ? { tags } : {}),
      ...(forkedFrom ? { forkedFrom } : {}),
      skin: skinResult.value,
    },
    errors,
    warnings,
  };
}

export function parseThemeFile(raw: unknown): ThemeFile {
  const result = validateThemeFile(raw);
  if (!result.ok || !result.value) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  return result.value;
}

/** Stable JSON for hashing and record data. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (isRecord(input)) {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])]),
      );
    }

    return input;
  };

  return JSON.stringify(normalize(value));
}

export async function skinHash(skin: Skin): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(skin));
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const UI_SIZE_SCALE: Record<UiSize, number> = { small: 0.9, default: 1, large: 1.15 };
const UI_DENSITY_SCALE: Record<UiDensity, number> = {
  compact: 0.875,
  default: 1,
  spacious: 1.125,
};
const UI_RADIUS_SCALE: Record<UiRadius, number> = { square: 0.25, default: 1, round: 1.5 };

export function uiScale(geometry: SkinGeometry): {
  size: number;
  density: number;
  radius: number;
} {
  return {
    size: UI_SIZE_SCALE[geometry.size],
    density: UI_DENSITY_SCALE[geometry.density],
    radius: UI_RADIUS_SCALE[geometry.radius],
  };
}

function cssFamily(family: string): string {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function fontStacks(settings: {
  font?: string | null;
  mathFont?: string | null;
  codeFont?: string | null;
}): { sans: string; mono: string; math: string } {
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

export function themeCssVar(token: string): string {
  return `--color-${token.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase()}`;
}

function fontFeatureSettings(typography: SkinTypography): string {
  const features: string[] = [];
  if (!typography.ligatures) features.push('"liga" 0', '"clig" 0');
  if (!typography.kerning) features.push('"kern" 0');

  return features.length ? features.join(", ") : "normal";
}

/**
 * The backdrop sits behind the island gap. It is one step darker than the
 * panes in both modes, so the gap reads without a border. Dark themes use a
 * deeper step because shadows do less work there.
 */
export function backdropFor(palette: ThemePaletteTokens, mode: "light" | "dark" = "light"): string {
  const dark = mode === "dark" || relativeLuminance(parseColor(palette.surface)) < 0.35;

  return dark
    ? mixHex("#000000", palette.surface, 0.48)
    : mixHex("#000000", palette.surface, 0.055);
}

/**
 * The CSS variables a skin writes to the document root. The app, the live
 * preview, and external preview tools read the same map.
 */
export function skinToCssVars(skin: Skin, mode: "light" | "dark"): Record<string, string> {
  const palette = skin.palette[mode];
  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(palette)) {
    vars[themeCssVar(token)] = value;
  }

  const stacks = fontStacks(skin.typography);
  vars["--font-sans"] = stacks.sans;
  vars["--font-mono"] = stacks.mono;
  vars["--font-math"] = stacks.math;

  const scale = uiScale(skin.geometry);
  vars["--ui-size"] = String(scale.size);
  vars["--ui-density"] = String(scale.density);
  vars["--ui-radius"] = String(scale.radius);
  vars["--doc-text-size"] = `${skin.typography.textSize}px`;
  vars["--doc-font-features"] = fontFeatureSettings(skin.typography);

  vars["--color-backdrop"] = backdropFor(palette, mode);

  return vars;
}

/** The settings a skin writes into a workspace. */
export function settingsFromSkin(
  skin: Skin,
  provenance?: Partial<WorkspaceSettings["themeProvenance"]>,
): Partial<WorkspaceSettings> {
  return {
    themeName: "custom",
    themeCustom: skin.palette,
    uiSize: skin.geometry.size,
    uiDensity: skin.geometry.density,
    uiRadius: skin.geometry.radius,
    font: skin.typography.font,
    mathFont: skin.typography.mathFont,
    codeFont: skin.typography.codeFont,
    textSize: skin.typography.textSize,
    typography: {
      ligatures: skin.typography.ligatures,
      kerning: skin.typography.kerning,
    },
    themeProvenance: {
      source: provenance?.source ?? null,
      version: provenance?.version ?? null,
      schema: provenance?.schema ?? null,
      forkedFrom: provenance?.forkedFrom ?? null,
      modified: provenance?.modified ?? false,
    },
  };
}

/** A skin from the current workspace settings and resolved palettes. */
export function skinFromSettings(settings: WorkspaceSettings, palettes: CustomThemePalettes): Skin {
  return {
    schema: SKIN_SCHEMA_VERSION,
    palette: palettes,
    geometry: {
      size: settings.uiSize,
      density: settings.uiDensity,
      radius: settings.uiRadius,
    },
    typography: {
      font: settings.font,
      mathFont: settings.mathFont,
      codeFont: settings.codeFont,
      textSize: settings.textSize,
      ligatures: settings.typography.ligatures,
      kerning: settings.typography.kerning,
    },
  };
}
