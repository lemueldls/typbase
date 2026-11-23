import type { PageTextEvent } from "@typbase/storage";

import { MemoryBackend, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("page text operations", () => {
  it("reports an editor splice as a delta with the editor origin", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "text-delta");
    const page = store.listPages()[0]!;
    const events: PageTextEvent[] = [];
    const stop = await store.onPageTextChange(page.id, (event) => events.push(event));

    expect(store.applyPageTextChanges(page.id, [{ from: 0, to: 0, insert: "Intro\n\n" }])).toBe(
      true,
    );
    stop();

    expect(store.getPageText(page.id).startsWith("Intro\n\n")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.origin).toBe("editor");
    expect(events[0]?.delta).toEqual([{ insert: "Intro\n\n" }]);
  });

  it("keeps concurrent edits from two devices", async () => {
    const backend = new MemoryBackend();
    const first = await WorkspaceStore.open(backend, "concurrent-text");
    const page = first.listPages()[0]!;
    const original = first.getPageText(page.id);
    await first.flush();

    const second = await WorkspaceStore.open(backend, "concurrent-text");
    await second.loadPageText(page.id);

    // Both sides edit from the same snapshot: one at the start, one at the
    // end. Neither write may delete the other.
    first.applyPageTextChanges(page.id, [{ from: 0, to: 0, insert: "first " }]);
    second.applyPageTextChanges(page.id, [
      {
        from: second.getPageText(page.id).length,
        to: second.getPageText(page.id).length,
        insert: " second",
      },
    ]);

    const events: PageTextEvent[] = [];
    const stop = await first.onPageTextChange(page.id, (event) => events.push(event));
    await first.importDocBytes(page.id, (await second.exportDocSnapshot(page.id)).bytes);
    stop();

    const text = first.getPageText(page.id);
    expect(text.startsWith("first ")).toBe(true);
    expect(text).toContain(" second");
    expect(text).toContain(original);
    expect(events.some((event) => event.delta.some((op) => op.insert === " second"))).toBe(true);
  });

  it("appends a block atomically", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "append-text");
    const page = store.listPages()[0]!;

    const next = await store.appendPageText(page.id, "= Added");

    expect(next.endsWith("\n= Added\n")).toBe(true);
    expect(store.getPageText(page.id)).toBe(next);
  });
});
