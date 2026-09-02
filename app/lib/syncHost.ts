import type { SyncHost } from "@typbase/spaces";
import type { WorkspaceStore } from "@typbase/storage";

/**
 * SyncHost implementation over the local store. The engine deals in bytes
 * and version strings; this is where Loro docs come in. All the version math
 * (JSON version vectors) belongs to the store.
 */
export function createSyncHost(
  store: WorkspaceStore,
  log: SyncHost["engineLog"],
  resolveMemberPds?: (did: string) => Promise<string>,
): SyncHost {
  return {
    listDocIds: () => store.listDocIds(),
    exportUpdatesSince: (docId, sinceVersion) => store.exportUpdatesSince(docId, sinceVersion),
    exportSnapshot: (docId) => store.exportDocSnapshot(docId),
    importUpdate: async (docId, bytes) => {
      await store.importDocBytes(docId, bytes);
    },
    importSnapshot: async (docId, bytes) => {
      await store.importDocBytes(docId, bytes);
    },
    localVersion: (docId) => store.getDocVersion(docId),
    onImported: (docIds) => {
      // The store's own subscriptions already refresh open editors; the
      // event exists for side systems like the search index that watch from
      // outside (settings, palette, query cache).
      window.dispatchEvent(new CustomEvent("typbase:imported", { detail: docIds }));
    },
    getMemberPds: resolveMemberPds,
    engineLog: log,
  };
}
