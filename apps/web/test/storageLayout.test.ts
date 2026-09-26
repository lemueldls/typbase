import { MemoryBackend, isPluginChange, isSourceChange, migrateLayout } from "@typbase/storage";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function write(backend: MemoryBackend, path: string, text: string): Promise<void> {
  await backend.write(path, encoder.encode(text));
}

async function read(backend: MemoryBackend, path: string): Promise<string | null> {
  const bytes = await backend.read(path);

  return bytes ? decoder.decode(bytes) : null;
}

describe("migrateLayout", () => {
  it("moves the pre-restructure tree into the current layout", async () => {
    const backend = new MemoryBackend();
    await write(backend, "workspaces/x/workspace.loro", "workspace");
    await write(backend, "workspaces/x/pages/p1.loro", "page doc");
    await write(backend, "workspaces/x/plugins/i1.loro", "plugin doc");
    await write(backend, "workspaces/x/chats/c1.loro", "chat doc");
    await write(backend, "workspaces/x/local.json", "{}");
    await write(backend, "workspaces/x/sources/pages/foo.typ", "= Foo");
    await write(backend, "workspaces/x/sources/typbase/lib.typ", "#let x = 1");
    await write(backend, "workspaces/x/blobs/abc", "media");

    expect(await migrateLayout(backend)).toBe(7);

    expect(await read(backend, "workspaces/x/state/workspace.loro")).toBe("workspace");
    expect(await read(backend, "workspaces/x/state/pages/p1.loro")).toBe("page doc");
    expect(await read(backend, "workspaces/x/state/plugins/i1.loro")).toBe("plugin doc");
    expect(await read(backend, "workspaces/x/state/chats/c1.loro")).toBe("chat doc");
    expect(await read(backend, "workspaces/x/state/local.json")).toBe("{}");
    expect(await read(backend, "workspaces/x/pages/foo.typ")).toBe("= Foo");
    expect(await read(backend, "workspaces/x/typbase/lib.typ")).toBe("#let x = 1");

    expect(await read(backend, "workspaces/x/workspace.loro")).toBeNull();
    expect(await read(backend, "workspaces/x/sources/pages/foo.typ")).toBeNull();
    expect(await read(backend, "workspaces/x/pages/p1.loro")).toBeNull();
    // Blobs were already at the root and do not move.
    expect(await read(backend, "workspaces/x/blobs/abc")).toBe("media");
    expect(await read(backend, "layout.json")).toBe('{"version":2}');
  });

  it("is a no-op once the marker exists, so new `sources/` pages survive", async () => {
    const backend = new MemoryBackend();
    expect(await migrateLayout(backend)).toBe(0);
    await write(backend, "workspaces/x/sources/notes.typ", "= Kept");

    expect(await migrateLayout(backend)).toBe(0);
    expect(await read(backend, "workspaces/x/sources/notes.typ")).toBe("= Kept");
  });

  it("resumes a partially moved workspace", async () => {
    const backend = new MemoryBackend();
    await write(backend, "workspaces/x/state/workspace.loro", "workspace");
    await write(backend, "workspaces/x/sources/pages/foo.typ", "= Foo");

    await migrateLayout(backend);

    expect(await read(backend, "workspaces/x/state/workspace.loro")).toBe("workspace");
    expect(await read(backend, "workspaces/x/pages/foo.typ")).toBe("= Foo");
    expect(await read(backend, "workspaces/x/sources/pages/foo.typ")).toBeNull();
  });
});

describe("isSourceChange", () => {
  it("accepts page sources and rejects app-owned paths", () => {
    expect(isSourceChange("pages/foo.typ")).toBe(true);
    expect(isSourceChange("daily/2026-09-22.typ")).toBe(true);
    expect(isSourceChange("notes/deep/nested.typ")).toBe(true);

    expect(isSourceChange("state/workspace.loro")).toBe(false);
    expect(isSourceChange("typbase/entries/pages/foo.typ")).toBe(false);
    expect(isSourceChange("blobs/abc.png")).toBe(false);
    expect(isSourceChange("artifacts/pages/foo.typ")).toBe(false);
    expect(isSourceChange("plugins/calendar/main.typ")).toBe(false);
    expect(isSourceChange("pages/.hidden.typ")).toBe(false);
    expect(isSourceChange(".git/objects/foo.typ")).toBe(false);
    expect(isSourceChange("pages/foo.md")).toBe(false);
    expect(isSourceChange("")).toBe(false);
  });
});

describe("isPluginChange", () => {
  it("accepts plugin authoring files and nothing else", () => {
    expect(isPluginChange("plugins/calendar/main.typ")).toBe(true);
    expect(isPluginChange("plugins/calendar/style.css")).toBe(true);
    expect(isPluginChange("plugins/calendar/plugin.json")).toBe(true);

    expect(isPluginChange("pages/foo.typ")).toBe(false);
    expect(isPluginChange("plugins/.cache/main.typ")).toBe(false);
    expect(isPluginChange("plugins/calendar/icon.png")).toBe(false);
    expect(isPluginChange("")).toBe(false);
  });
});
