import { MemoryBackend, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("joining a remote workspace", () => {
  it("opens an empty local doc so the first sync pull supplies the history", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "joined-space", {
      seed: false,
    });

    expect(store.listPages()).toEqual([]);
  });
});
