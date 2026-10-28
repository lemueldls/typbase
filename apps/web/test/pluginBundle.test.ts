import { createPluginBundle, parsePluginBundle } from "@typbase/plugin-sdk";
import { MemoryBackend } from "@typbase/storage";
import { describe, expect, it } from "vitest";

import { installPluginBundle } from "../src/lib/plugins/bundle";
import { parseManifest } from "../src/lib/plugins/manifest";

const manifest = parseManifest({
  id: "local:demo",
  name: "Demo",
  version: "1.0.0",
  api: "typbase.host.v2",
  entry: "main.typ",
  capabilities: ["plugin.data"],
  collections: {},
  surfaces: [{ kind: "widget", fn: "widget", title: "Demo" }],
});

describe("plugin bundles", () => {
  it("round-trips the manifest and source files", () => {
    const bytes = createPluginBundle(manifest, [
      { path: "main.typ", text: "#let widget(ctx) = [hello]" },
      { path: "style.css", text: ".demo { color: red; }" },
    ]);
    const bundle = parsePluginBundle(bytes);

    expect(bundle.manifest.id).toBe("local:demo");
    expect(bundle.files).toEqual([
      { path: "main.typ", text: "#let widget(ctx) = [hello]" },
      { path: "style.css", text: ".demo { color: red; }" },
    ]);
  });

  it("rejects paths that escape the plugin root", () => {
    expect(() => createPluginBundle(manifest, [{ path: "../outside.typ", text: "bad" }])).toThrow(
      /unsafe/,
    );
  });

  it("does not allow a second plugin.json", () => {
    const bytes = createPluginBundle(manifest, [{ path: "plugin.json", text: "{}" }]);

    expect(parsePluginBundle(bytes).files).toEqual([]);
  });
});

describe("installing a plugin bundle", () => {
  it("replaces the local plugin folder and removes stale files", async () => {
    const backend = new MemoryBackend();
    const encoder = new TextEncoder();
    await backend.write("plugins/demo/old.typ", encoder.encode("old"));
    await backend.write("plugins/demo/lib/stale.typ", encoder.encode("stale"));

    await installPluginBundle(backend, manifest, [
      { path: "main.typ", text: "#let widget(ctx) = [new]" },
      { path: "lib/format.typ", text: "#let format(x) = x" },
    ]);

    expect(await backend.read("plugins/demo/main.typ")).toEqual(
      encoder.encode("#let widget(ctx) = [new]"),
    );
    expect(await backend.read("plugins/demo/lib/format.typ")).toEqual(
      encoder.encode("#let format(x) = x"),
    );
    expect(await backend.read("plugins/demo/old.typ")).toBeNull();
    expect(await backend.read("plugins/demo/lib/stale.typ")).toBeNull();
    expect(await backend.read("plugins/demo/plugin.json")).not.toBeNull();
  });
});
