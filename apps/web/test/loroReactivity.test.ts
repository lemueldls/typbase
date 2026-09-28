import { MemoryBackend, WorkspaceStore, pathsOverlap } from "@typbase/storage";
import { describe, expect, it, vi } from "vitest";

describe("pathsOverlap", () => {
  it("matches equal and prefix paths in both directions", () => {
    expect(pathsOverlap(["categories"], ["categories"])).toBe(true);
    expect(pathsOverlap(["categories"], ["categories", 0])).toBe(true);
    expect(pathsOverlap(["categories", 0], ["categories"])).toBe(true);
    expect(pathsOverlap([], ["pages"])).toBe(true);
  });

  it("rejects disjoint paths", () => {
    expect(pathsOverlap(["categories"], ["pages"])).toBe(false);
    expect(pathsOverlap(["categories", 1], ["categories", 0])).toBe(false);
    expect(pathsOverlap(["pages", "a"], ["pages", "b", "title"])).toBe(false);
  });
});

describe("workspace change subscriptions", () => {
  it("fires only for the containers that changed", async () => {
    const backend = new MemoryBackend();
    const store = await WorkspaceStore.open(backend, "paths-test");

    const categories = vi.fn();
    const pages = vi.fn();
    const settings = vi.fn();
    store.onWorkspaceChange([["categories"]], categories);
    store.onWorkspaceChange([["pages"]], pages);
    store.onWorkspaceChange([["settings"]], settings);

    await store.addCategory("Research");
    expect(categories).toHaveBeenCalledTimes(1);
    expect(pages).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();

    const page = store.listPages()[0]!;
    await store.updatePageTitle(page.id, "Renamed");
    expect(pages).toHaveBeenCalledTimes(1);
    expect(categories).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();

    store.updateSettings({ name: "Renamed workspace" });
    expect(settings).toHaveBeenCalledTimes(1);
    expect(pages).toHaveBeenCalledTimes(1);
  });

  it("fires a nested listener when its parent container changes", async () => {
    const backend = new MemoryBackend();
    const store = await WorkspaceStore.open(backend, "nested-paths-test");

    const page = store.listPages()[0]!;
    const nested = vi.fn();
    store.onWorkspaceChange([["pages", page.id]], nested);

    // Deleting from the `pages` map emits the parent path. The nested
    // listener must still hear it or a deleted page would go stale.
    await store.deletePage(page.id);
    expect(nested).toHaveBeenCalled();
  });

  it("moves a page between categories and clears unknown ones", async () => {
    const backend = new MemoryBackend();
    const store = await WorkspaceStore.open(backend, "category-test");

    const category = await store.addCategory("Research");
    const page = store.listPages()[0]!;

    await store.updatePageCategory(page.id, category.id);
    expect(store.getPage(page.id)?.categoryId).toBe(category.id);

    // A category that no longer exists must not hide the page from every group.
    await store.updatePageCategory(page.id, "missing");
    expect(store.getPage(page.id)?.categoryId).toBeNull();

    await store.updatePageCategory(page.id, category.id);
    await store.updatePageCategory(page.id, null);
    expect(store.getPage(page.id)?.categoryId).toBeNull();
  });
});
