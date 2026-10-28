import type { StorageBackend } from "@typbase/storage";
import type { PluginManifest } from "@typbase/typing";

import { pluginManifestText, type PluginBundleFile } from "@typbase/plugin-sdk";

import { pluginSlug } from "./manifest";

const encoder = new TextEncoder();

async function removeTree(backend: StorageBackend, path: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await backend.list(path);
  } catch {
    return;
  }

  for (const name of entries) {
    const child = `${path}/${name}`;
    const stat = await backend.stat(child).catch(() => null);
    if (stat?.kind === "directory") {
      await removeTree(backend, child);
      continue;
    }

    // Some backends expose only files, so a nested folder shows up as its
    // first path segment with no directory stat. Ask for its children instead
    // of deleting a path that is really a parent.
    const nested = await backend.list(child).catch(() => []);
    if (nested.length) await removeTree(backend, child);
    else await backend.delete(child);
  }
}

/**
 * Replaces the local source folder for one plugin. The bundle parser has
 * already checked paths; this only makes the folder match the release.
 */
export async function installPluginBundle(
  backend: StorageBackend,
  manifest: PluginManifest,
  files: PluginBundleFile[],
): Promise<string> {
  const root = `plugins/${pluginSlug(manifest.id)}`;
  await removeTree(backend, root);
  await backend.write(`${root}/plugin.json`, encoder.encode(pluginManifestText(manifest)));
  for (const file of files) {
    await backend.write(`${root}/${file.path}`, encoder.encode(file.text));
  }

  return root;
}
