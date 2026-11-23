import type { WorkspaceInfo } from "@typbase/typing";

import { MemoryBackend, WorkspaceRegistry, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

const space = {
  uri: "at://did:plc:alice/space/at.typbase.workspace/work",
  ownerDid: "did:plc:alice",
  skey: "work",
};

describe("shared workspace registry entry", () => {
  it("keeps the space ref and role", async () => {
    const registry = new WorkspaceRegistry(new MemoryBackend());
    const info: WorkspaceInfo = {
      id: "local-id",
      name: "Shared",
      space,
      spaceRole: "viewer",
      createdAt: 1,
      lastOpenedAt: 1,
    };

    await registry.save(info);
    expect(await registry.list()).toEqual([info]);
  });
});

describe("joined workspace doc id", () => {
  it("syncs the workspace doc under the shared space key", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "local-id", {
      seed: false,
      syncId: "work",
    });

    expect(store.syncId).toBe("work");
    expect(await store.listDocIds()).toContain("work");
    expect(await store.getDocById("work")).not.toBeNull();
  });
});

describe("read-only workspace store", () => {
  it("refuses pages, settings, and text changes", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "viewer", {
      seed: false,
      readOnly: true,
    });

    expect(store.readOnly).toBe(true);
    expect(store.applyPageTextChanges("page", [])).toBe(false);
    await expect(store.createPage({ title: "Nope" })).rejects.toThrow(/read-only/);

    const before = store.getSettings().name;
    store.updateSettings({ name: "Changed" });
    expect(store.getSettings().name).toBe(before);
  });
});
