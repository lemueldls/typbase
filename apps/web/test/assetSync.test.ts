import type { AssetRecord, AssetRemote, AssetSyncHost } from "@typbase/spaces";

import { AssetSync } from "@typbase/spaces";
import { hashBytes, sniffMime } from "@typbase/storage";
import { describe, expect, it, vi } from "vitest";

class MemoryRemote implements AssetRemote {
  readonly records = new Map<string, AssetRecord>();
  readonly bytes = new Map<string, Uint8Array>();

  async list(): Promise<AssetRecord[]> {
    return [...this.records.values()];
  }

  async get(hash: string): Promise<AssetRecord | null> {
    return this.records.get(hash) ?? null;
  }

  async upload(asset: Parameters<AssetRemote["upload"]>[0], bytes: Uint8Array) {
    const record: AssetRecord = {
      ...asset,
      cid: `cid-${asset.hash.slice(0, 8)}`,
      blob: { $type: "blob" },
      createdAt: new Date(0).toISOString(),
    };
    this.records.set(asset.hash, record);
    this.bytes.set(asset.hash, bytes);

    return record;
  }

  async download(asset: AssetRecord): Promise<Uint8Array> {
    const bytes = this.bytes.get(asset.hash);
    if (!bytes) throw new Error(`missing bytes for ${asset.hash}`);

    return bytes;
  }

  add(bytes: Uint8Array, address: string): Promise<AssetRecord> {
    return hashBytes(bytes).then((hash) => {
      const record: AssetRecord = {
        hash,
        address,
        cid: `cid-${hash.slice(0, 8)}`,
        mime: sniffMime(bytes),
        size: bytes.byteLength,
        kind: "file",
        blob: { $type: "blob" },
        createdAt: new Date(0).toISOString(),
      };
      this.records.set(hash, record);
      this.bytes.set(hash, bytes);

      return record;
    });
  }
}

class MemoryHost implements AssetSyncHost {
  readonly blobs = new Map<string, Uint8Array>();
  private readonly listeners = new Set<(hash: string) => void>();

  async listBlobs(): Promise<Array<{ hash: string }>> {
    return [...this.blobs.keys()].map((hash) => ({ hash }));
  }

  async readBlob(hash: string): Promise<Uint8Array | null> {
    return this.blobs.get(hash) ?? null;
  }

  async putBlob(bytes: Uint8Array): Promise<{ hash: string }> {
    const hash = await this.hash(bytes);
    this.blobs.set(hash, bytes);
    for (const listener of this.listeners) listener(hash);

    return { hash };
  }

  hash(bytes: Uint8Array): Promise<string> {
    return hashBytes(bytes);
  }

  mime(bytes: Uint8Array): string {
    return sniffMime(bytes);
  }

  onBlobStored(listener: (hash: string) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }
}

const encoder = new TextEncoder();

describe("asset sync", () => {
  it("uploads local blobs with their content address", async () => {
    const host = new MemoryHost();
    const remote = new MemoryRemote();
    const bytes = encoder.encode("OTTO local font");
    const { hash } = await host.putBlob(bytes);
    const sync = new AssetSync(host, remote);

    await sync.syncNow();

    const record = remote.records.get(hash);
    expect(record?.address).toBe(hash);
    expect(record?.size).toBe(bytes.byteLength);
    expect(record?.kind).toBe("font");
    expect(sync.status().error).toBeNull();
  });

  it("downloads a remote blob and reports the address", async () => {
    const host = new MemoryHost();
    const remote = new MemoryRemote();
    const bytes = encoder.encode("remote bytes");
    const record = await remote.add(bytes, "remote-address");
    const sync = new AssetSync(host, remote);

    await sync.syncNow();

    expect(host.blobs.get(record.hash)).toEqual(bytes);
    expect(sync.status().revision).toBe(1);
    expect(sync.status().lastSyncedAt).toBeGreaterThan(0);
  });

  it("uploads a blob added while the sync is running", async () => {
    const host = new MemoryHost();
    const remote = new MemoryRemote();
    const sync = new AssetSync(host, remote);
    sync.start();
    await sync.syncNow();

    const bytes = encoder.encode("a new image");
    const { hash } = await host.putBlob(bytes);
    await vi.waitFor(() => expect(remote.records.has(hash)).toBe(true));
    sync.stop();
  });

  it("downloads remote blobs even when nothing references them", async () => {
    const host = new MemoryHost();
    const remote = new MemoryRemote();
    const record = await remote.add(encoder.encode("unused"), "unused-address");
    const sync = new AssetSync(host, remote);

    await sync.syncNow();

    expect(host.blobs.get(record.hash)).toBeDefined();
  });

  it("rejects a remote blob whose hash does not match", async () => {
    const host = new MemoryHost();
    const remote = new MemoryRemote();
    const bytes = encoder.encode("tampered");
    const record = await remote.add(bytes, "wrong-address");
    remote.records.delete(record.hash);
    remote.bytes.delete(record.hash);
    record.hash = "0".repeat(64);
    remote.records.set(record.hash, record);
    remote.bytes.set(record.hash, bytes);
    const sync = new AssetSync(host, remote);

    await sync.syncNow();

    expect(host.blobs.size).toBe(0);
    expect(sync.status().error).toContain("hash mismatch");
  });
});
