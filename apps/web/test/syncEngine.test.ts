import type { SyncHost, SyncSnapshot, SyncStore, SyncTransport, SyncUpdate } from "@typbase/spaces";

import { TypbaseSync, bytesToBase64, decodeRecordBytes } from "@typbase/spaces";
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
  it("compresses an oversized queued update before uploading", async () => {
    const payload = new Uint8Array(90_000).fill(0x61);
    const sent: Array<Omit<SyncUpdate, "rkey">> = [];
    const syncHost = host();
    const sync = new TypbaseSync(
      syncHost,
      {
        get: async () => ({
          docs: {},
          queue: [
            {
              docId,
              update: bytesToBase64(payload),
              version: '{"actor":1}',
              createdAt: 0,
            },
          ],
          lastUpdateRkey: null,
          lastSnapshotRkey: null,
          lastFullScanAt: 0,
          lastExportAt: 0,
          lastImportAt: 0,
        }),
        set: async () => {},
      },
      {
        ...transport([]),
        createUpdate: async (record) => {
          sent.push(record);

          return "new";
        },
      },
    );

    await sync.start();
    sync.stop();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.update.startsWith("gzip:")).toBe(true);
    await expect(decodeRecordBytes(sent[0]!.update)).resolves.toEqual(payload);
  });

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
