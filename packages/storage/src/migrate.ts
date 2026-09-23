import type { StorageBackend } from "./backend";

import { workspaceRoot } from "./workspace";

/**
 * One-time move from the pre-restructure layout to the current one:
 *
 *   workspace.loro, pages/, plugins/, chats/, local.json -> state/
 *   sources/** -> the workspace root
 *
 * The boot path calls `migrateLayout` once, gated by a `layout.json` marker at
 * the storage root. Removing this feature means deleting this file and that
 * call: the marker left behind is inert, and the fresh-layout code already
 * ignores the old paths.
 *
 * Every move is read -> write -> delete, so an interrupted run resumes and a
 * second run is a no-op. Blobs were already at the root and stay put.
 */

const LAYOUT_FILE = "layout.json";
const LAYOUT_VERSION = 2;

/** Legacy directories that moved under `state/`. */
const LEGACY_STATE_DIRS = ["pages", "plugins", "chats"] as const;

const decoder = new TextDecoder();

/**
 * Migrates every workspace under the backend root when the marker is missing
 * or older. Returns the number of files moved (0 on an already-current root).
 */
export async function migrateLayout(backend: StorageBackend): Promise<number> {
  if (await isCurrentLayout(backend)) return 0;

  let moved = 0;
  for (const id of await backend.list("workspaces")) {
    moved += await migrateWorkspace(backend, id);
  }

  await backend.write(
    LAYOUT_FILE,
    new TextEncoder().encode(JSON.stringify({ version: LAYOUT_VERSION })),
  );

  return moved;
}

async function isCurrentLayout(backend: StorageBackend): Promise<boolean> {
  const bytes = await backend.read(LAYOUT_FILE);
  if (!bytes) return false;

  try {
    const marker = JSON.parse(decoder.decode(bytes)) as { version?: unknown };

    return typeof marker.version === "number" && marker.version >= LAYOUT_VERSION;
  } catch {
    return false;
  }
}

async function migrateWorkspace(backend: StorageBackend, workspaceId: string): Promise<number> {
  const root = workspaceRoot(workspaceId);
  const stat = await backend.stat(root).catch(() => null);
  if (stat?.kind !== "directory") return 0;

  let moved = 0;
  moved += await moveFile(backend, `${root}/workspace.loro`, `${root}/state/workspace.loro`);
  moved += await moveFile(backend, `${root}/local.json`, `${root}/state/local.json`);
  for (const dir of LEGACY_STATE_DIRS) {
    moved += await moveTree(backend, `${root}/${dir}`, `${root}/state/${dir}`);
  }
  moved += await moveTree(backend, `${root}/sources`, root);

  return moved;
}

/** Copies one file to its new path and drops the old one. */
async function moveFile(backend: StorageBackend, from: string, to: string): Promise<number> {
  const bytes = await backend.read(from);
  if (bytes === null) return 0;

  await backend.write(to, bytes);
  await backend.delete(from);

  return 1;
}

async function moveTree(backend: StorageBackend, from: string, to: string): Promise<number> {
  const stat = await backend.stat(from).catch(() => null);
  if (!stat) return 0;
  if (stat.kind === "file") return moveFile(backend, from, to);

  let entries: string[] = [];
  try {
    entries = await backend.list(from);
  } catch {
    return 0;
  }

  let moved = 0;
  for (const name of entries) {
    moved += await moveTree(backend, `${from}/${name}`, `${to}/${name}`);
  }

  await backend.delete(from).catch(() => {});
  return moved;
}
