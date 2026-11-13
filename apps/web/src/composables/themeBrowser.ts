import type { ThemeFile } from "@typbase/skin";
import type { WorkspaceStore } from "@typbase/storage";
import type { WorkspaceSettings } from "@typbase/typing";

import {
  parseThemeFile,
  previewPalette,
  settingsFromSkin,
  skinFromSettings,
  validateThemeFile,
} from "@typbase/skin";
import {
  publishTheme as publishThemeRecord,
  resolvePublishedTheme,
  themeSlug,
  unpublishTheme,
} from "@typbase/spaces/theme-registry";

import type { AtprotoService } from "~/lib/atproto";

import { applyTheme } from "~/composables/theme";
import { resolveTheme } from "~/lib/themes";

export interface ThemePublishInput {
  name: string;
  description?: string;
  license?: string;
  tags: string[];
  slug: string;
  version: string;
  changelog?: string;
  forkedFrom?: string;
}

export interface ThemeResult {
  listingUri: string;
  releaseUri: string;
  version: string;
  sha256: string;
}

export interface RegistryTheme {
  uri: string;
  publisher: string;
  name: string;
  description: string;
  tags: string[];
  license: string;
  version: string | null;
  schema: string | null;
  release: string | null;
  sha256: string | null;
  preview: {
    light: {
      mode: "light" | "dark";
      surface: string;
      surface2: string;
      surface3: string;
      text: string;
      accent: string;
      code: string;
    };
    dark: {
      mode: "light" | "dark";
      surface: string;
      surface2: string;
      surface3: string;
      text: string;
      accent: string;
      code: string;
    };
  } | null;
  warnings: string[];
  error: string | null;
}

export function registryUrl(): string {
  const config = useRuntimeConfig();

  return String(config.public.registryUrl ?? "").replace(/\/+$/, "");
}

export function themeFileFromSettings(
  settings: WorkspaceSettings,
  metadata: Pick<ThemeFile, "name" | "description" | "license" | "tags" | "forkedFrom">,
): ThemeFile {
  const palettes = {
    light: resolveTheme({ ...settings, theme: "light" }).palette,
    dark: resolveTheme({ ...settings, theme: "dark" }).palette,
  };

  return {
    schema: "typbase.theme.v1",
    name: metadata.name,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.license ? { license: metadata.license } : {}),
    ...(metadata.tags?.length ? { tags: metadata.tags } : {}),
    ...(metadata.forkedFrom ? { forkedFrom: metadata.forkedFrom } : {}),
    skin: skinFromSettings(settings, palettes),
  };
}

export function applyThemeFile(store: WorkspaceStore, theme: ThemeFile, source?: string): void {
  store.updateSettings(
    settingsFromSkin(theme.skin, {
      source: source ?? null,
      version: null,
      schema: theme.skin.schema,
      forkedFrom: theme.forkedFrom ?? null,
      modified: false,
    }),
  );
  applyTheme(store.getSettings());
  bumpRenderRevision();
}

export async function applyPublishedTheme(store: WorkspaceStore, uri: string): Promise<ThemeFile> {
  const resolved = await resolvePublishedTheme(uri.trim());
  applyThemeFile(store, resolved.theme, resolved.uri);
  const settings = store.getSettings();
  store.updateSettings({
    themeProvenance: {
      ...settings.themeProvenance,
      source: resolved.uri,
      version: resolved.release.version,
      schema: resolved.theme.skin.schema,
      forkedFrom: resolved.theme.forkedFrom ?? null,
      modified: false,
    },
  });
  applyTheme(store.getSettings());
  bumpRenderRevision();

  return resolved.theme;
}

export function importThemeFile(text: string): ThemeFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Theme file is not JSON.");
  }

  return parseThemeFile(raw);
}

export function exportThemeFile(theme: ThemeFile): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

export function validateThemeMetadata(theme: ThemeFile): { errors: string[]; warnings: string[] } {
  const result = validateThemeFile(theme);

  return {
    errors: result.errors.map((error) => `${error.path}: ${error.message}`),
    warnings: result.warnings.map((warning) => warning.message),
  };
}

export async function listRegistryThemes(base: string): Promise<{
  themes: RegistryTheme[];
  warnings: string[];
}> {
  const root = base.replace(/\/+$/, "");
  if (!root) return { themes: [], warnings: [] };

  const response = await fetch(`${root}/api/themes`);
  if (!response.ok) throw new Error(`Theme registry request failed (${response.status}).`);
  const data = (await response.json()) as {
    themes?: RegistryTheme[];
    warnings?: string[];
  };

  return {
    themes: Array.isArray(data.themes) ? data.themes : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

export async function publishCurrentTheme(
  store: WorkspaceStore,
  metadata: ThemePublishInput,
  atproto: AtprotoService | undefined,
): Promise<ThemeResult> {
  const session = atproto?.session;
  if (!session) throw new Error("Sign in before publishing a theme.");
  if (!(await atproto.hasThemePublishingScope())) {
    throw new Error("Reconnect your account to grant theme publishing access.");
  }

  const theme = themeFileFromSettings(store.getSettings(), metadata);
  const result = validateThemeFile(theme);
  if (!result.ok || !result.value) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  const slug = metadata.slug || themeSlug(metadata.name);
  const published = await publishThemeRecord(session, session.did, {
    slug,
    version: metadata.version,
    theme: result.value,
    ...(metadata.changelog ? { changelog: metadata.changelog } : {}),
  });

  store.updateSettings({
    themeProvenance: {
      source: published.listingUri,
      version: published.version,
      schema: result.value.skin.schema,
      forkedFrom: metadata.forkedFrom ?? null,
      modified: false,
    },
  });

  return published;
}

export async function unpublishCurrentTheme(
  store: WorkspaceStore,
  atproto: AtprotoService | undefined,
): Promise<void> {
  const provenance = store.getSettings().themeProvenance;
  const source = provenance.source;
  const session = atproto?.session;
  if (!source || !session) throw new Error("No published theme is active.");
  const sourceDid = source.split("/")[2];
  if (sourceDid !== session.did) throw new Error("This theme belongs to another publisher.");
  const slug = source.split("/").at(-1);
  if (!slug) throw new Error("The theme source has no listing key.");

  await unpublishTheme(session, session.did, slug);
  store.updateSettings({
    themeProvenance: {
      source: null,
      version: null,
      schema: provenance.schema,
      forkedFrom: provenance.forkedFrom,
      modified: false,
    },
  });
}

export async function checkThemeUpdate(store: WorkspaceStore): Promise<{
  available: boolean;
  version: string | null;
  uri: string | null;
} | null> {
  const provenance = store.getSettings().themeProvenance;
  if (!provenance.source) return null;

  const resolved = await resolvePublishedTheme(provenance.source);
  const available = resolved.release.version !== provenance.version;

  return {
    available,
    version: resolved.release.version,
    uri: resolved.uri,
  };
}

export function themePreview(theme: ThemeFile) {
  return {
    light: previewPalette(theme.skin.palette.light, "light"),
    dark: previewPalette(theme.skin.palette.dark, "dark"),
  };
}
