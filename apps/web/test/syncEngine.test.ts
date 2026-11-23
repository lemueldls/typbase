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

  it("skips an update the doc rejects and keeps reading", async () => {
    const syncHost = host();
    syncHost.importUpdate = async (_docId, bytes) => {
      if (new TextDecoder().decode(bytes) === "bad") throw new Error("UsedOpID");

      syncHost.imported.push(bytes);
    };
    const sync = new TypbaseSync(
      syncHost,
      memoryStore(),
      transport([
        { rkey: "b", docId, update: btoa("bad"), version: '{"actor":2}' },
        { rkey: "a", docId, update: btoa("good"), version: '{"actor":1}' },
      ]),
    );

    await sync.start();
    sync.stop();

    expect(syncHost.imported).toHaveLength(1);
    expect(new TextDecoder().decode(syncHost.imported[0])).toBe("good");
  });

  it("queues both docs when commits overlap", async () => {
    let releaseFirst!: () => void;
    const firstExport = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    const syncHost = host();
    syncHost.listDocIds = async () => ["a", "b"];
    syncHost.exportUpdatesSince = async (id) => {
      if (id === "a") {
        enteredFirst();
        await firstExport;
      }

      return {
        bytes: new TextEncoder().encode(id),
        version: JSON.stringify({ [id]: 1 }),
      };
    };

    const sent: string[] = [];
    const sync = new TypbaseSync(syncHost, memoryStore(), {
      ...transport([]),
      createUpdate: async (record) => {
        sent.push(record.docId);

        return `rkey-${sent.length}`;
      },
    });

    await sync.start();
    const first = sync.onLocalCommit("a");
    await firstEntered;
    const second = sync.onLocalCommit("b");
    releaseFirst();
    await Promise.all([first, second]);
    await sync.flushQueue();
    sync.stop();

    expect(sent.sort()).toEqual(["a", "b"]);
  });

  it("pulls every writer with its own cursor", async () => {
    let saved: unknown;
    const store: SyncStore = {
      get: async () => saved,
      set: async (_key, value) => {
        saved = value;
      },
    };
    const calls: Array<[string | undefined, string | null]> = [];
    const syncHost = host();
    const sync = new TypbaseSync(syncHost, store, {
      ...transport([]),
      listRepos: async () => ["alice", "bob"],
      listUpdates: async (cursor, repo) => {
        calls.push([repo, cursor]);
        const first = calls.length <= 2;

        return {
          records: [
            {
              rkey: first ? (repo === "alice" ? "a1" : "b1") : repo === "alice" ? "a0" : "b0",
              docId,
              update: btoa(repo ?? "own"),
              version: JSON.stringify({ [repo ?? "own"]: first ? 1 : 2 }),
            },
          ],
          cursor: null,
        };
      },
    });

    await sync.start();
    await sync.pull();
    sync.stop();

    expect(calls).toEqual([
      ["alice", null],
      ["bob", null],
      ["alice", null],
      ["bob", null],
    ]);
    expect(saved).toMatchObject({
      writerCursors: { updates: { alice: "a1", bob: "b1" } },
    });
    expect(syncHost.imported).toHaveLength(2);
  });

  it("does not export from a read-only member", async () => {
    const syncHost = host();
    syncHost.exportUpdatesSince = async () => ({
      bytes: new TextEncoder().encode("local"),
      version: '{"actor":1}',
    });
    const sent: string[] = [];
    const sync = new TypbaseSync(
      syncHost,
      memoryStore(),
      {
        ...transport([]),
        createUpdate: async () => {
          sent.push("update");

          return "rkey";
        },
        createSnapshot: async () => {
          sent.push("snapshot");

          return "rkey";
        },
      },
      { readOnly: true },
    );

    await sync.start();
    await sync.bootstrapSnapshots();
    await sync.exportPending();
    await sync.onLocalCommit(docId);
    await sync.flushQueue();
    sync.stop();

    expect(sent).toEqual([]);
  });
  it("exports edits a previous session never queued", async () => {
    const syncHost = host();
    syncHost.listDocIds = async () => [docId];
    syncHost.exportUpdatesSince = async () => ({
      bytes: new TextEncoder().encode("offline"),
      version: '{"actor":1}',
    });

    const sent: string[] = [];
    const sync = new TypbaseSync(syncHost, memoryStore(), {
      ...transport([]),
      createUpdate: async (record) => {
        sent.push(record.docId);

        return "rkey";
      },
    });

    await sync.start();
    await sync.exportPending();
    await sync.flushQueue();
    sync.stop();

    expect(sent).toEqual([docId]);
  });
});

function memoryStore(): SyncStore {
  let saved: unknown;

  return {
    get: async () => saved,
    set: async (_key, value) => {
      saved = value;
    },
  };
}
