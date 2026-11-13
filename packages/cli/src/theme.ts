import type { ThemeFile } from "@typbase/skin";

import { canonicalJson, parseThemeFile, skinHash, validateThemeFile } from "@typbase/skin";
import { publishTheme, themeSlug } from "@typbase/spaces/theme-registry";
import { readFile } from "node:fs/promises";

import { publishSession, type AuthOptions } from "./auth";

export interface VerifyThemeOptions {
  strict?: boolean;
  json?: boolean;
}

export interface ThemeVerification {
  ok: boolean;
  file: string;
  name: string;
  schema: string;
  hash: string;
  size: number;
  errors: string[];
  warnings: string[];
}

async function readTheme(file: string): Promise<ThemeFile> {
  const text = await readFile(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("theme file is not JSON");
  }

  return parseThemeFile(raw);
}

export async function verifyTheme(
  file: string,
  options: VerifyThemeOptions = {},
): Promise<ThemeVerification> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      file,
      name: "",
      schema: "",
      hash: "",
      size: 0,
      errors: [cause instanceof Error ? cause.message : String(cause)],
      warnings: [],
    };
  }

  const result = validateThemeFile(raw);
  if (!result.ok || !result.value) {
    return {
      ok: false,
      file,
      name: "",
      schema: "",
      hash: "",
      size: 0,
      errors: result.errors.map((error) => `${error.path}: ${error.message}`),
      warnings: result.warnings.map((warning) => warning.message),
    };
  }

  const data = canonicalJson(result.value.skin);
  const hash = await skinHash(result.value.skin);
  const warnings = result.warnings.map((warning) => warning.message);
  const strictFailure = options.strict === true && warnings.length > 0;

  return {
    ok: !strictFailure,
    file,
    name: result.value.name,
    schema: result.value.skin.schema,
    hash,
    size: new TextEncoder().encode(data).byteLength,
    errors: strictFailure ? ["strict mode treats warnings as errors"] : [],
    warnings,
  };
}

export interface PublishThemeOptions extends AuthOptions {
  slug?: string;
  version?: string;
  changelog?: string;
}

export async function publishThemeFile(
  file: string,
  options: PublishThemeOptions,
): Promise<{
  listingUri: string;
  releaseUri: string;
  version: string;
  sha256: string;
}> {
  const theme = await readTheme(file);
  const verification = await verifyTheme(file);
  if (!verification.ok) {
    throw new Error(verification.errors.join("; ") || "theme did not verify");
  }

  const { session, did } = await publishSession(options);
  const slug = options.slug ?? themeSlug(theme.name);
  const version = options.version ?? "1.0.0";

  return publishTheme(session, did, {
    slug,
    version,
    theme,
    ...(options.changelog ? { changelog: options.changelog } : {}),
  });
}
