import { MemoryBackend, WorkspaceRegistry, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("page order", () => {
  it("follows the manual order and appends new pages to it", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "page-order");
    // The store seeds a home page; keep it in the expected order.
    const seeded = store.listPages().map((page) => page.id);
    const a = await store.createPage({ title: "A" });
    const b = await store.createPage({ title: "B" });
    const c = await store.createPage({ title: "C" });

    store.reorderPages([c.id, a.id, b.id, ...seeded]);
    expect(store.listPages().map((page) => page.id)).toEqual([c.id, a.id, b.id, ...seeded]);

    // The order is normalized now, so a new page goes to the end.
    const d = await store.createPage({ title: "D" });
    expect(store.listPages().map((page) => page.id)).toEqual([c.id, a.id, b.id, ...seeded, d.id]);
  });
});

describe("category order", () => {
  it("follows the manual order", async () => {
    const store = await WorkspaceStore.open(new MemoryBackend(), "category-order");
    const first = await store.addCategory("First");
    const second = await store.addCategory("Second");
    const third = await store.addCategory("Third");

    expect(store.listCategories().map((category) => category.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    store.reorderCategories([third.id, first.id, second.id]);
    expect(store.listCategories().map((category) => category.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });
});

describe("workspace order", () => {
  it("rewrites the registry in the given order", async () => {
    const backend = new MemoryBackend();
    const registry = new WorkspaceRegistry(backend);
    await registry.save({ id: "a", name: "A", createdAt: 1, lastOpenedAt: 1 });
    await registry.save({ id: "b", name: "B", createdAt: 2, lastOpenedAt: 2 });
    await registry.save({ id: "c", name: "C", createdAt: 3, lastOpenedAt: 3 });

    await registry.reorder(["c", "a", "b"]);
    expect((await registry.list()).map((entry) => entry.id)).toEqual(["c", "a", "b"]);

    // Ids the caller does not mention keep their relative spots at the end.
    await registry.reorder(["b"]);
    expect((await registry.list()).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });
});
