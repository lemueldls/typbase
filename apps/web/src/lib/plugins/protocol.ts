import type { InstalledPackage, ThemePaletteTokens } from "@typbase/typing";
import type { TypstRequest } from "@typbase/wasm";

/** Types crossing the host <-> plugin-worker boundary. */

export interface PluginSurfaceSource {
  /** Virtual path under `/typbase/plugin/<slug>/` or the UI library path. */
  path: string;
  text: string;
}

export interface PluginSurfaceFile {
  path: string;
  bytes: Uint8Array;
}

/** A package the request loop fetched for this surface. */
export interface PluginSurfacePackage {
  spec: InstalledPackage;
  bytes: Uint8Array;
}

export interface PluginSurfaceStyle {
  font: string;
  mathFont: string | null;
  codeFont: string | null;
  textSize: number;
  palette: ThemePaletteTokens;
}

export interface PluginSurfaceInput {
  spaceId: string;
  slug: string;
  entry: string;
  fn: string;
  sources: PluginSurfaceSource[];
  /** Binary files the request loop resolved (query JSON, images, ...). */
  files?: PluginSurfaceFile[];
  /** Packages the request loop fetched; installed before the compile. */
  packages?: PluginSurfacePackage[];
  ctx: unknown;
  style: PluginSurfaceStyle;
}

export interface PluginSurfaceResult {
  html: string;
  diagnostics: unknown[];
  requests: TypstRequest[];
  /** Which engine compiled this surface; local is the worker fallback. */
  engine?: "worker" | "local";
  /** Why the worker was abandoned, when it was. */
  fallbackReason?: string;
}

export interface PluginCompileRequest extends PluginSurfaceInput {
  type: "compile";
  id: number;
}

export type PluginCompileResponse =
  | {
      type: "result";
      id: number;
      ok: true;
      html: string;
      diagnostics: unknown[];
      requests: TypstRequest[];
    }
  | { type: "result"; id: number; ok: false; error: string }
  | { type: "crash"; message: string; stack?: string };
