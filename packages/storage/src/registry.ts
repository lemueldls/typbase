import type { WorkspaceInfo } from "@typbase/typing";

import type { StorageBackend } from "./backend";

/**
 * The workspace registry: one JSON manifest at the backend root listing every
 * workspace. `lastOpenedAt` is the only ordering signal; the name is a cache
 * of the workspace doc's `settings.name`, kept fresh on open/rename.
 */

const REGISTRY_FILE = "workspaces.json";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class WorkspaceRegistry {
  constructor(private readonly backend: StorageBackend) {}

  async list(): Promise<WorkspaceInfo[]> {
    const bytes = await this.backend.read(REGISTRY_FILE);
    if (!bytes) return [];

    try {
      const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (entry): entry is WorkspaceInfo =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as WorkspaceInfo).id === "string" &&
          typeof (entry as WorkspaceInfo).name === "string",
      );
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<WorkspaceInfo | undefined> {
    return (await this.list()).find((entry) => entry.id === id);
  }

  async save(entry: WorkspaceInfo): Promise<void> {
    const entries = await this.list();
    const index = entries.findIndex((existing) => existing.id === entry.id);
    if (index === -1) entries.push(entry);
    else entries[index] = entry;
    await this.backend.write(REGISTRY_FILE, encoder.encode(JSON.stringify(entries)));
  }

  async remove(id: string): Promise<void> {
    const entries = (await this.list()).filter((entry) => entry.id !== id);
    await this.backend.write(REGISTRY_FILE, encoder.encode(JSON.stringify(entries)));
  }
}

/**
 * Deletes everything under `workspaces/<id>`, children first, then the
 * directory itself. OPFS treats directories as entries; the recursive walk
 * makes the same code work for the flat memory backend.
 */
export async function removeWorkspace(backend: StorageBackend, workspaceId: string): Promise<void> {
  const prefix = `workspaces/${workspaceId}`;
  await removeEntryRecursive(backend, prefix);
}

async function removeEntryRecursive(backend: StorageBackend, path: string): Promise<void> {
  const children = await backend.list(path);
  if (children.length > 0) {
    for (const child of children) {
      await removeEntryRecursive(backend, `${path}/${child}`);
    }
  }
  await backend.delete(path).catch(() => {
    // Already gone; fine.
  });
}
