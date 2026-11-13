import type { PluginManifest } from "@typbase/typing";

import {
  createPluginBundle,
  parseManifest,
  pluginBundleHash,
  pluginSlug,
  verifyPluginBundle,
} from "@typbase/plugin-sdk";
import { describe, expect, it } from "vitest";

const manifest: PluginManifest = {
  id: "local:test",
  name: "Test",
  version: "0.1.0",
  api: "typbase.host.v2",
  entry: "main.typ",
  capabilities: ["plugin.data"],
  collections: { notes: { fields: { text: { type: "string" } } } },
  surfaces: [{ kind: "pane", fn: "pane", title: "Test" }],
};

describe("plugin sdk", () => {
  it("validates a manifest", () => {
    expect(parseManifest(manifest).name).toBe("Test");
    expect(pluginSlug(manifest.id)).toBe("test");
  });

  it("rejects an unknown capability", () => {
    expect(() => parseManifest({ ...manifest, capabilities: ["everything"] })).toThrow(
      /unknown capability/,
    );
  });

  it("builds and verifies a bundle", async () => {
    const bundle = createPluginBundle(manifest, [
      { path: "main.typ", text: "#let pane(ctx) = none" },
      { path: "style.css", text: "/* test */" },
    ]);
    const verified = verifyPluginBundle(bundle);
    expect(verified.ok).toBe(true);
    expect(verified.manifest?.id).toBe("local:test");
    expect(await pluginBundleHash(bundle)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a missing entry file", () => {
    const bundle = createPluginBundle(manifest, [{ path: "other.typ", text: "x" }]);
    const verified = verifyPluginBundle(bundle);
    expect(verified.ok).toBe(false);
    expect(verified.errors.some((error) => error.includes("entry"))).toBe(true);
  });

  it("rejects unsafe paths", () => {
    expect(() => createPluginBundle(manifest, [{ path: "../escape.typ", text: "x" }])).toThrow(
      /unsafe/,
    );
  });
});
