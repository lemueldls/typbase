import type { AssetSyncHost } from "@typbase/spaces";
import type { WorkspaceStore } from "@typbase/storage";

import { hashBytes, sniffMime } from "@typbase/storage";

/** Wires the transport-neutral asset sync to the local blob store. */
export function createAssetHost(store: WorkspaceStore): AssetSyncHost {
  return {
    listBlobs: () => store.listBlobs(),
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
