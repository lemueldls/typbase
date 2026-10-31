import type { SyncHost, SyncSnapshot, SyncStore, SyncTransport, SyncUpdate } from "@typbase/spaces";

import { TypbaseSync } from "@typbase/spaces";
import { describe, expect, it, vi } from "vitest";

const docId = "workspace";

function host(): SyncHost & { imported: Uint8Array[] } {
  const imported: Uint8Array[] = [];

  return {
    imported,
    listDocIds: async () => [docId],
    exportUpdatesSince: async () => null,
    exportSnapshot: async () => ({ bytes: new Uint8Array(), version: "{}" }),
    importUpdate: async (_docId, bytes) => {
      imported.push(bytes);
    },
    importSnapshot: async () => {},
    localVersion: async () => "",
    onImported: vi.fn(),
    engineLog: vi.fn(),
  };
}

function transport(updates: SyncUpdate[]): SyncTransport {
  return {
    listUpdates: async () => ({ records: updates, cursor: null }),
    listSnapshots: async () => ({ records: [] as SyncSnapshot[], cursor: null }),
    createUpdate: async () => "new",
    createSnapshot: async () => "new",
    deleteUpdates: async () => {},
    deleteSnapshots: async () => {},
  };
}

describe("TypbaseSync", () => {
  it("scans past a stale cursor on start", async () => {
    const saved: SyncStore = {
      get: async () => ({
        docs: {},
        queue: [],
        lastUpdateRkey: "z",
        lastSnapshotRkey: null,
        lastFullScanAt: Date.now(),
        lastExportAt: 0,
        lastImportAt: 0,
      }),
      set: async () => {},
    };
    const syncHost = host();
    const sync = new TypbaseSync(
      syncHost,
      saved,
      transport([
        {
          rkey: "a",
          docId,
          update: btoa("update"),
          version: '{"actor":1}',
        },
      ]),
    );

    await sync.start();
    sync.stop();

    expect(syncHost.imported).toHaveLength(1);
    expect(syncHost.onImported).toHaveBeenCalledWith([docId]);
  });
});
