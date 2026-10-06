import type { WorkspaceStore } from "@typbase/storage";

import { pluginSourceFiles, pluginSlugs } from "~/lib/plugins/registry";

/**
 * Every file an exported project needs in order to resolve a plugin.
 */
export async function pluginProjectFiles(
  store: WorkspaceStore,
): Promise<{ path: string; text: string }[]> {
  const files = pluginSourceFiles();

  for (const instance of store.listPluginInstances()) {
    files.push({
      path: `typbase/query/plugin-data/${instance.id}.json`,
      text: JSON.stringify(await store.readPluginState(instance.id)),
    });
  }

  return files;
}

/** One line for a bundle README, naming what the bundle carries. */
export function pluginBundleSummary(): string | null {
  const slugs = pluginSlugs();
  if (!slugs.length) return null;

  return `- \`typbase/plugin/\`: every installed plugin module (${slugs.join(", ")})`;
}
