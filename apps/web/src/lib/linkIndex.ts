import type { WorkspaceStore } from "@typbase/storage";

import { resolveAppTheme } from "~/composables/theme";
import { useTypst } from "~/composables/typst";
import {
  purgeLinkResolver,
  resolvePageLinks,
  setLinkResolverStore,
  setLinkWorkerStyle,
  stopLinkResolver,
} from "~/lib/linkResolver";
import { LinkIndex } from "~/lib/links";
import { pageContextBinding } from "~/lib/pageContext";
import { publishPrelude } from "~/lib/publishPrelude";

/**
 * One `LinkIndex` per open workspace, shared by the backlinks panel, the
 * graph, and `#typbase.query("backlinks")`. The engine extractor and the
 * worker-backed dynamic-link resolver are wired here so `lib/links.ts` stays
 * free of wasm and Vue imports.
 */
const indexes = new Map<string, LinkIndex>();

/** The workspace's index, created on first use. Callers still `start()` it. */
export function getLinkIndex(store: WorkspaceStore): LinkIndex {
  let index = indexes.get(store.workspaceId);
  if (!index) {
    index = new LinkIndex(
      store,
      (text) => extractLinks(text),
      createResolver(store),
      purgeLinkResolver,
    );
    indexes.set(store.workspaceId, index);
    // A worker shared across workspaces must not answer with the previous
    // workspace's query JSON.
    purgeLinkResolver();
  }

  return index;
}

/** Stops and drops indexes for workspaces that are no longer open. */
export function dropLinkIndexes(activeId: string | null): void {
  let dropped = false;
  for (const [id, index] of indexes) {
    if (id === activeId) continue;

    index.stop();
    indexes.delete(id);
    dropped = true;
  }

  // The worker is shared, so a job still queued for the closed workspace must
  // not compile against the new workspace's store.
  if (dropped) stopLinkResolver(new Error("Workspace switched; the link resolver was reset."));
}

/**
 * Compiles one page in the resolver worker. The prelude and style come from
 * the workspace settings, the same way chat renders, so query loops resolve
 * under the app's real fonts and theme.
 */
function createResolver(store: WorkspaceStore) {
  return async (pageId: string, source: string): Promise<string[]> => {
    const settings = store.getSettings();
    setLinkResolverStore(store);
    setLinkWorkerStyle({
      font: settings.font,
      mathFont: settings.mathFont,
      codeFont: settings.codeFont,
      textSize: settings.textSize,
      palette: resolveAppTheme(settings).palette,
    });
    const prelude = await publishPrelude(settings, {
      theme: "workspace",
      paged: false,
      context: pageContextBinding(store, pageId),
    });

    return resolvePageLinks({ pageId, source, prelude, spaceId: store.workspaceId });
  };
}

async function extractLinks(text: string) {
  const state = await useTypst();

  return state.extractLinks(text);
}
