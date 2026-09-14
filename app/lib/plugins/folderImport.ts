import type { StorageBackend } from "@typbase/storage";
import type { PluginManifest } from "@typbase/typing";

import { isFsaSupported, pickDirectory } from "@typbase/storage";

import { parseManifest, pluginSlug } from "./manifest";

interface CollectedFile {
  path: string;
  text: string;
}

async function collect(dir: FileSystemDirectoryHandle, prefix = ""): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  const entries = (
    dir as unknown as { values(): AsyncIterable<[string, FileSystemHandle]> }
  ).values();

  for await (const [name, handle] of entries) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (!/\.(typ|json|txt|md|toml)$/i.test(name)) continue;
      if (file.size > 512 * 1024) continue; // sources only; skip media
      files.push({ path, text: await file.text() });
    } else {
      files.push(...(await collect(handle as FileSystemDirectoryHandle, path)));
    }
  }

  return files;
}

/**
 * Copies a picked folder into the workspace storage under `plugins/<slug>`.
 * Chromium-only: the File System Access API is the only portable way to read
 * an outside folder. Desktop users can drop plugins into the storage root by
 * hand instead. Returns null when the picker is cancelled.
 */
export async function importPluginFolder(backend: StorageBackend): Promise<PluginManifest | null> {
  if (!isFsaSupported()) throw new Error("Folder import needs the File System Access API.");

  const dir = await pickDirectory();
  if (!dir) return null;

  const files = await collect(dir);
  const manifestFile = files.find((file) => file.path === "plugin.json");
  if (!manifestFile) throw new Error("The folder has no plugin.json at its root.");

  const manifest = parseManifest(JSON.parse(manifestFile.text) as unknown);
  const root = `plugins/${pluginSlug(manifest.id)}`;
  const encoder = new TextEncoder();

  for (const file of files) {
    await backend.write(`${root}/${file.path}`, encoder.encode(file.text));
  }

  return manifest;
}
