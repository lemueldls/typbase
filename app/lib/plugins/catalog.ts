import type { StorageBackend } from "@typbase/storage";
import type { PluginManifest } from "@typbase/typing";

import uiLibrarySource from "../../../public/plugins/ui.typ?raw";
import { parseManifest, pluginSlug } from "./manifest";

/**
 * Plugin discovery. Bundled examples are inlined by Vite from
 * `public/plugins/`; local plugins are read from the workspace storage tree
 * under `plugins/<name>/`, which is a real folder on desktop roots and the
 * OPFS tree in the browser. Installing never copies anything: the install
 * record in the workspace doc only points at a manifest id.
 */

export interface CatalogPlugin {
  manifest: PluginManifest;
  slug: string;
  /** `bundled` ships with the app; `local` came from the storage tree. */
  source: "bundled" | "local";
  /** Storage folder for local plugins, e.g. `plugins/calendar`. */
  storageDir?: string;
  /** Virtual Typst paths already rooted at `/typbase-plugin/<slug>/`. */
  sources: { path: string; text: string }[];
}

export const UI_LIBRARY_PATH = "/typbase-ui.typ";
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

export function loadBundledCatalog(): CatalogPlugin[] {
  const catalog: CatalogPlugin[] = [];

  for (const [manifestPath, raw] of Object.entries(manifestModules)) {
    const root = manifestPath.slice(0, manifestPath.lastIndexOf("/"));

    try {
      const manifest = parseManifest(JSON.parse(raw));
      const sources: { path: string; text: string }[] = [];

      for (const [sourcePath, text] of Object.entries(sourceModules)) {
        if (!sourcePath.startsWith(`${root}/`)) continue;
        const relative = sourcePath.slice(root.length + 1);
        sources.push({ path: `/typbase-plugin/${pluginSlug(manifest.id)}/${relative}`, text });
      }

      catalog.push({ manifest, slug: pluginSlug(manifest.id), source: "bundled", sources });
    } catch (error) {
      console.error(`[plugins] invalid bundled manifest at ${manifestPath}:`, error);
    }
  }

  return catalog;
}

async function readTypFiles(
  backend: StorageBackend,
  dir: string,
  prefix: string,
): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  let entries: string[] = [];
  try {
    entries = await backend.list(dir);
  } catch {
    return files;
  }

  for (const name of entries) {
    const path = `${dir}/${name}`;
    let stat;
    try {
      stat = await backend.stat(path);
    } catch {
      continue;
    }
    if (!stat) continue;

    if (stat.kind === "directory") {
      files.push(...(await readTypFiles(backend, path, `${prefix}/${name}`)));
      continue;
    }

    if (!name.endsWith(".typ")) continue;
    const bytes = await backend.read(path);
    if (!bytes) continue;
    files.push({ path: `${prefix}/${name}`, text: new TextDecoder().decode(bytes) });
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
      const sources = await readTypFiles(backend, `plugins/${dir}`, `/typbase-plugin/${slug}`);
      catalog.push({ manifest, slug, source: "local", storageDir: `plugins/${dir}`, sources });
    } catch (error) {
      console.error(`[plugins] invalid local manifest at plugins/${dir}:`, error);
    }
  }

  return catalog;
}
