import { MemoryBackend, removeWorkspace } from "@typbase/storage";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();

/**
 * Tauri's `read_dir` returns ENOTDIR for a file, while the browser and memory
 * backends return an empty list. The recursive delete must not depend on
 * listing files.
 */
class StrictDirectoryBackend extends MemoryBackend {
  override async list(path: string): Promise<string[]> {
    const stat = await this.stat(path);
    if (stat?.kind === "file") {
      throw new Error(`failed to list ${path}: Not a directory`);
    }

    return super.list(path);
  }
}

describe("removeWorkspace", () => {
  it("removes files without listing them as directories", async () => {
    const backend = new StrictDirectoryBackend();
    await backend.write("workspaces/gone/daily/2026-10-22.typ", encoder.encode("= Thursday"));
    await backend.write("workspaces/gone/state/workspace.loro", encoder.encode("workspace"));
    await backend.write("workspaces/kept/pages/home.typ", encoder.encode("= Home"));

    await removeWorkspace(backend, "gone");

    expect(await backend.stat("workspaces/gone")).toBeNull();
    expect(await backend.stat("workspaces/kept/pages/home.typ")).not.toBeNull();
  });
});
