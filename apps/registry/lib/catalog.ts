import { listPublisherPlugins, type PluginCatalogEntry } from "@typbase/spaces/plugin-registry";
import { listPublisherThemes, type ThemeCatalogEntry } from "@typbase/spaces/theme-registry";
import { useRuntimeConfig } from "nitro/runtime-config";

const CACHE_MS = 60_000;

interface CatalogCache {
  at: number;
  plugins: PluginCatalogEntry[];
  themes: ThemeCatalogEntry[];
  warnings: string[];
}

let cache: CatalogCache | null = null;

export function registryPublishers(): string[] {
  const runtime = useRuntimeConfig() as { registryPublishers?: string };

  return (runtime.registryPublishers || process.env.REGISTRY_PUBLISHERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function registryCatalog(): Promise<{
  publishers: string[];
  plugins: PluginCatalogEntry[];
  themes: ThemeCatalogEntry[];
  warnings: string[];
}> {
  const publishers = registryPublishers();
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return {
      publishers,
      plugins: cache.plugins,
      themes: cache.themes,
      warnings: cache.warnings,
    };
  }

  const [pluginResults, themeResults] = await Promise.all([
    Promise.allSettled(
      publishers.map(async (publisher) => ({
        publisher,
        entries: await listPublisherPlugins(publisher),
      })),
    ),
    Promise.allSettled(
      publishers.map(async (publisher) => ({
        publisher,
        entries: await listPublisherThemes(publisher),
      })),
    ),
  ]);

  const plugins: PluginCatalogEntry[] = [];
  const themes: ThemeCatalogEntry[] = [];
  const warnings: string[] = [];

  for (const [index, result] of pluginResults.entries()) {
    if (result.status === "fulfilled") plugins.push(...result.value.entries);
    else warnings.push(`plugins ${publishers[index]}: ${String(result.reason)}`);
  }
  for (const [index, result] of themeResults.entries()) {
    if (result.status === "fulfilled") themes.push(...result.value.entries);
    else warnings.push(`themes ${publishers[index]}: ${String(result.reason)}`);
  }

  plugins.sort((left, right) => left.listing.name.localeCompare(right.listing.name));
  themes.sort((left, right) => left.listing.name.localeCompare(right.listing.name));
  cache = { at: Date.now(), plugins, themes, warnings };

  return { publishers, plugins, themes, warnings };
}
