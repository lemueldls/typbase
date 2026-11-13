import type { PluginManifest } from "@typbase/typing";

/** The JSON envelope stored in a plugin release blob. */
export const PLUGIN_BUNDLE_FORMAT = "typbase.plugin.bundle.v1";

export const PLUGIN_BUNDLE_EXTENSION = ".tbplugin";

export const PLUGIN_BUNDLE_MIME = "application/json";

export interface PluginBundleFile {
  /** Path relative to the plugin root, e.g. `main.typ` or `lib/format.typ`. */
  path: string;
  /** Plugin files are Typst or CSS text. Binary assets belong elsewhere. */
  text: string;
}

export interface PluginBundle {
  format: typeof PLUGIN_BUNDLE_FORMAT;
  manifest: PluginManifest;
  files: PluginBundleFile[];
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !path.split("/").includes("..") &&
    !path.split("\\").includes("..") &&
    /^[\w./-]+$/.test(path)
  );
}

/**
 * Builds the artifact a plugin release points at. The manifest is repeated
 * inside the artifact so an installed copy and the release record can be
 * checked against the same source.
 */
export function createPluginBundle(
  manifest: PluginManifest,
  files: PluginBundleFile[],
): Uint8Array {
  const normalized = files
    .filter((file) => file.path !== "plugin.json")
    .map((file) => {
      if (!safeRelativePath(file.path)) throw new Error(`unsafe plugin file path "${file.path}"`);

      return { path: file.path, text: file.text };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const bundle: PluginBundle = {
    format: PLUGIN_BUNDLE_FORMAT,
    manifest,
    files: normalized,
  };

  return new TextEncoder().encode(JSON.stringify(bundle));
}

/** Reads an artifact before the host validates its manifest. */
export function parsePluginBundle(bytes: Uint8Array): PluginBundle {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("plugin bundle is not JSON");
  }
  if (!value || typeof value !== "object") throw new Error("plugin bundle is not an object");

  const raw = value as {
    format?: unknown;
    manifest?: unknown;
    files?: unknown;
  };
  if (raw.format !== PLUGIN_BUNDLE_FORMAT) {
    throw new Error(`unsupported plugin bundle format "${String(raw.format)}"`);
  }
  if (!raw.manifest || typeof raw.manifest !== "object") {
    throw new Error("plugin bundle has no manifest");
  }
  if (!Array.isArray(raw.files)) throw new Error("plugin bundle has no files");

  const files: PluginBundleFile[] = [];
  for (const entry of raw.files) {
    if (!entry || typeof entry !== "object") throw new Error("plugin bundle file is not an object");
    const file = entry as { path?: unknown; text?: unknown };
    if (typeof file.path !== "string" || !safeRelativePath(file.path)) {
      throw new Error(`plugin bundle has an unsafe file path "${String(file.path)}"`);
    }
    if (file.path === "plugin.json") throw new Error("plugin bundle must not include plugin.json");
    if (typeof file.text !== "string") {
      throw new Error(`plugin bundle file "${file.path}" is not text`);
    }
    files.push({ path: file.path, text: file.text });
  }

  return {
    format: PLUGIN_BUNDLE_FORMAT,
    manifest: raw.manifest as PluginManifest,
    files,
  };
}

/** The manifest file written beside an installed bundle's sources. */
export function pluginManifestText(manifest: PluginManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
