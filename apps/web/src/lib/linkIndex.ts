import type { WorkspaceStore } from "@typbase/storage";

import { useTypst } from "~/composables/typst";
import { LinkIndex } from "~/lib/links";

/**
 * One `LinkIndex` per open workspace, shared by the backlinks panel, the
 * graph, and `#typbase.query("backlinks")`. The engine extractor is wired
 * here so `lib/links.ts` stays free of wasm and Vue imports.
 */
const indexes = new Map<string, LinkIndex>();

/** The workspace's index, created on first use; callers still `start()` it. */
export function getLinkIndex(store: WorkspaceStore): LinkIndex {
  let index = indexes.get(store.workspaceId);
  if (!index) {
    index = new LinkIndex(store, (text) => extractLinks(text));
    indexes.set(store.workspaceId, index);
  }

  return index;
}

/** Stops and drops indexes for workspaces that are no longer open. */
export function dropLinkIndexes(activeId: string | null): void {
  for (const [id, index] of indexes) {
    if (id === activeId) continue;

    index.stop();
    indexes.delete(id);
  }
}

async function extractLinks(text: string) {
  const state = await useTypst();

  return state.extractLinks(text);
}
