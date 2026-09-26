import type { StorageBackend } from "@typbase/storage";
import type { PluginManifest } from "@typbase/typing";

import uiLibrarySource from "../../../public/plugins/ui.typ?raw";
import { parseManifest, pluginSlug } from "./manifest";

export interface CatalogPlugin {
  manifest: PluginManifest;
  slug: string;
  /** `bundled` ships with the app; `local` came from the storage tree. */
  source: "bundled" | "local";
  /** Storage folder for local plugins, e.g. `plugins/calendar`. */
  storageDir?: string;
  /** Virtual Typst paths already rooted at `/typbase/plugin/<slug>/`. */
  sources: { path: string; text: string }[];
  /** Plugin stylesheets, injected into the surface shadow root in order. */
  styles: { name: string; text: string }[];
}

export const UI_LIBRARY_PATH = "/typbase/ui.typ";
export { uiLibrarySource };

const manifestModules = import.meta.glob("../../../public/plugins/*/plugin.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const sourceModules = import.meta.glob("../../../public/plugins/*/**/*.typ", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const styleModules = import.meta.glob("../../../public/plugins/*/**/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function loadBundledCatalog(): CatalogPlugin[] {
  const catalog: CatalogPlugin[] = [];

  for (const [manifestPath, raw] of Object.entries(manifestModules)) {
    const root = manifestPath.slice(0, manifestPath.lastIndexOf("/"));

    try {
      const manifest = parseManifest(JSON.parse(raw));
      const sources: { path: string; text: string }[] = [];
      const styles: { name: string; text: string }[] = [];

      for (const [sourcePath, text] of Object.entries(sourceModules)) {
        if (!sourcePath.startsWith(`${root}/`)) continue;
        const relative = sourcePath.slice(root.length + 1);
        sources.push({ path: `/typbase/plugin/${pluginSlug(manifest.id)}/${relative}`, text });
      }
      for (const [stylePath, text] of Object.entries(styleModules)) {
        if (!stylePath.startsWith(`${root}/`)) continue;
        styles.push({ name: stylePath.slice(root.length + 1), text });
      }

      catalog.push({
        manifest,
        slug: pluginSlug(manifest.id),
        source: "bundled",
        sources,
        styles,
      });
    } catch (error) {
      console.error(`[plugins] invalid bundled manifest at ${manifestPath}:`, error);
    }
  }

  return catalog;
}

interface PluginFiles {
  sources: { path: string; text: string }[];
  styles: { name: string; text: string }[];
}

async function readPluginFiles(
  backend: StorageBackend,
  dir: string,
  prefix: string,
  relative = "",
): Promise<PluginFiles> {
  const files: PluginFiles = { sources: [], styles: [] };
  const target = relative ? `${dir}/${relative}` : dir;
  let entries: string[] = [];
  try {
    entries = await backend.list(target);
  } catch {
    return files;
  }

  for (const name of entries) {
    const path = `${target}/${name}`;
    const next = relative ? `${relative}/${name}` : name;
    let stat;
    try {
      stat = await backend.stat(path);
    } catch {
      continue;
    }
    if (!stat) continue;

    if (stat.kind === "directory") {
      const nested = await readPluginFiles(backend, dir, prefix, next);
      files.sources.push(...nested.sources);
      files.styles.push(...nested.styles);
      continue;
    }

    if (name.endsWith(".typ")) {
      const bytes = await backend.read(path);
      if (!bytes) continue;
      files.sources.push({ path: `${prefix}/${next}`, text: new TextDecoder().decode(bytes) });
    } else if (name.endsWith(".css")) {
      const bytes = await backend.read(path);
      if (!bytes) continue;
      files.styles.push({ name: next, text: new TextDecoder().decode(bytes) });
    }
  }

  return files;
}

/** Scans `plugins/<name>/` in the storage tree for installable plugins. */
export async function loadLocalCatalog(backend?: StorageBackend): Promise<CatalogPlugin[]> {
  if (!backend) return [];

  const catalog: CatalogPlugin[] = [];
  let dirs: string[] = [];
  try {
    dirs = await backend.list("plugins");
  } catch {
    return catalog;
  }

  for (const dir of dirs) {
    const manifestBytes = await backend.read(`plugins/${dir}/plugin.json`).catch(() => null);
    if (!manifestBytes) continue;

    try {
      const manifest = parseManifest(
        JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
      );
      const slug = pluginSlug(manifest.id);
      const files = await readPluginFiles(backend, `plugins/${dir}`, `/typbase/plugin/${slug}`);
      catalog.push({
        manifest,
        slug,
        source: "local",
        storageDir: `plugins/${dir}`,
        sources: files.sources,
        styles: files.styles,
      });
    } catch (error) {
      console.error(`[plugins] invalid local manifest at plugins/${dir}:`, error);
    }
  }

  return catalog;
}
