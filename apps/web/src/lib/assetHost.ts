import type { AssetSyncHost } from "@typbase/spaces";
import type { WorkspaceStore } from "@typbase/storage";

import { hashBytes, sniffMime } from "@typbase/storage";

/** Wires the transport-neutral asset sync to the local blob store. */
export function createAssetHost(store: WorkspaceStore): AssetSyncHost {
  return {
    listBlobs: () => store.listBlobs(),
    referencedBlobHashes: async () => {
      const references = await store.findBlobReferences();
      const hashes = new Set(references.keys());
      for (const font of store.getSettings().customFonts) {
        for (const hash of font.hashes) hashes.add(hash);
      }

      return hashes;
    },
    readBlob: (hash) => store.getBlob(hash),
    putBlob: (bytes) => store.putBlob(bytes),
    hash: hashBytes,
    mime: sniffMime,
    onBlobStored: (listener) =>
      store.onBlobChange((hash, change) => {
        if (change === "put") listener(hash);
      }),
  };
}
