import { listPublisherPlugins, type PluginCatalogEntry } from "@typbase/spaces/plugin-registry";
import { useRuntimeConfig } from "nitro/runtime-config";

const CACHE_MS = 60_000;

interface CatalogCache {
  at: number;
  entries: PluginCatalogEntry[];
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
  entries: PluginCatalogEntry[];
  warnings: string[];
}> {
  const publishers = registryPublishers();
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { publishers, entries: cache.entries, warnings: cache.warnings };
  }

  const results = await Promise.allSettled(
    publishers.map(async (publisher) => ({
      publisher,
      entries: await listPublisherPlugins(publisher),
    })),
  );
  const entries: PluginCatalogEntry[] = [];
  const warnings: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") entries.push(...result.value.entries);
    else warnings.push(`${publishers[index]}: ${String(result.reason)}`);
  }
  entries.sort((left, right) => left.listing.name.localeCompare(right.listing.name));
  cache = { at: Date.now(), entries, warnings };

  return { publishers, entries, warnings };
}
