import { MemoryBackend, WorkspaceStore, workspaceRoot } from "@typbase/storage";
import { describe, expect, it } from "vitest";

/** What `attachSourceSync` needs: the store's own key/value state. */
function memorySourceSync() {
  const data = new Map<string, unknown>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
    },
  };
}

async function storeWithMirror(name: string) {
  const backend = new MemoryBackend();
  const store = await WorkspaceStore.open(backend, name);
  store.attachSourceSync(memorySourceSync());

  return { backend, store };
}

const read = async (backend: MemoryBackend, path: string): Promise<string | null> => {
  const bytes = await backend.read(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

describe("slugify", () => {
  it("keeps unicode letters so a file can match a non-English title", async () => {
    const { store } = await storeWithMirror("slug");
    const page = await store.createPage({ title: "Ångström 的笔记" });

    expect(page.path).toBe("pages/ångström-的笔记.typ");
  });
});

describe("renaming a page", () => {
  it("moves the file while the path is the one the title derived", async () => {
    const { backend, store } = await storeWithMirror("rename-move");
    const seeded = store.listPages().map((entry) => entry.id);
    const page = await store.createPage({ title: "Notes", content: "= Notes\n" });
    await store.flush();
    const root = workspaceRoot("rename-move");

    expect(await read(backend, `${root}/${page.path}`)).toBe("= Notes\n");

    await store.updatePageTitle(page.id, "Ideas");

    expect(store.getPage(page.id)?.path).toBe("pages/ideas.typ");
    expect(await read(backend, `${root}/pages/notes.typ`)).toBeNull();
    expect(await read(backend, `${root}/pages/ideas.typ`)).toBe("= Notes\n");

    // The moved file must not come back as a second page.
    const result = await store.syncSources();
    expect(result.created).toEqual([]);
    expect(result.imported).toEqual([]);
    expect(store.listPages().map((entry) => entry.id)).toEqual([...seeded, page.id]);
  });

  it("keeps the file when the caller opts out", async () => {
    const { backend, store } = await storeWithMirror("rename-keep");
    const page = await store.createPage({ title: "Notes" });
    await store.flush();
    const root = workspaceRoot("rename-keep");

    await store.updatePageTitle(page.id, "Ideas", { renameFile: false });

    expect(store.getPage(page.id)?.path).toBe("pages/notes.typ");
    expect(await read(backend, `${root}/pages/notes.typ`)).not.toBeNull();
    expect(await read(backend, `${root}/pages/ideas.typ`)).toBeNull();
  });

  it("leaves a page whose file no longer follows the title alone", async () => {
    const { backend, store } = await storeWithMirror("rename-imported");
    const page = await store.createPage({ title: "Dropped in", path: "notes/dropped-in.typ" });
    await store.flush();
    const root = workspaceRoot("rename-imported");

    await store.updatePageTitle(page.id, "Renamed");

    expect(store.getPage(page.id)?.path).toBe("notes/dropped-in.typ");
    expect(await read(backend, `${root}/notes/dropped-in.typ`)).not.toBeNull();
  });

  it("leaves a daily note's date-keyed path alone", async () => {
    const { store } = await storeWithMirror("rename-daily");
    const page = await store.createDailyNote("2026-10-01");

    await store.updatePageTitle(page.id, "Morning");

    expect(store.getPage(page.id)?.path).toBe("daily/2026-10-01.typ");
  });

  it("keeps a case-only title change on the same file", async () => {
    const { store } = await storeWithMirror("rename-case");
    const page = await store.createPage({ title: "Linear algebra" });
    await store.flush();

    await store.updatePageTitle(page.id, "Linear Algebra");

    expect(store.getPage(page.id)?.path).toBe("pages/linear-algebra.typ");
  });

  it("suffixes a new path that another page already has", async () => {
    const { store } = await storeWithMirror("rename-clash");
    const target = await store.createPage({ title: "Ideas" });
    const source = await store.createPage({ title: "Notes" });
    await store.flush();

    await store.updatePageTitle(source.id, "Ideas");

    expect(store.getPage(source.id)?.path).toBe("pages/ideas-2.typ");
    expect(store.getPage(target.id)?.path).toBe("pages/ideas.typ");
  });
});

describe("deleting a page", () => {
  it("clears the home page id so the shell does not open a page that is gone", async () => {
    const { store } = await storeWithMirror("delete-home");
    const seeded = store.listPages()[0];
    expect(store.getSettings().homePageId).toBe(seeded?.id);

    await store.deletePage(seeded!.id);

    expect(store.getSettings().homePageId).toBeNull();
    expect(store.listPages()).toEqual([]);
  });

  it("leaves another page's home id alone", async () => {
    const { store } = await storeWithMirror("delete-other");
    const home = store.listPages()[0];
    const other = await store.createPage({ title: "Other" });

    await store.deletePage(other.id);

    expect(store.getSettings().homePageId).toBe(home?.id);
  });
});
