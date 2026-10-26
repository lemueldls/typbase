import { MemoryBackend, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("joining a remote workspace", () => {
  it("opens an empty local doc so the first sync pull supplies the history", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "joined-space", {
      seed: false,
    });

    expect(store.listPages()).toEqual([]);
  });

  it("accepts a page doc before its workspace metadata arrives", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "joined-early-page", {
      seed: false,
    });

    // The space can deliver a page snapshot before the workspace snapshot
    // that registers the page. Dropping the unknown id left notes empty.
    expect(await store.getDocById("remote-page")).not.toBeNull();
  });
});
