import { PLUGIN_API } from "@typbase/typing";
import { describe, expect, it } from "vitest";

import { parseManifest, pluginSlug, validatePatch } from "../src/lib/plugins/manifest";

const base = {
  id: "local:demo",
  name: "Demo",
  version: "0.1.0",
  api: PLUGIN_API,
  entry: "main.typ",
  capabilities: [],
  collections: {},
  surfaces: [{ kind: "pane", fn: "pane", title: "Demo" }],
};

describe("parseManifest", () => {
  it("accepts one surface of each kind", () => {
    const manifest = parseManifest({
      ...base,
      surfaces: [
        { kind: "widget", fn: "widget", title: "Demo" },
        { kind: "pane", fn: "pane", title: "Demo" },
        { kind: "window", fn: "window", title: "Demo" },
      ],
    });

    expect(manifest.surfaces.map((surface) => surface.kind)).toEqual(["widget", "pane", "window"]);
  });

  it("rejects the v1 api", () => {
    expect(() => parseManifest({ ...base, api: "typbase.host.v1" })).toThrow(/unsupported/);
  });

  it("rejects two surfaces of the same kind", () => {
    expect(() =>
      parseManifest({
        ...base,
        surfaces: [
          { kind: "pane", fn: "pane", title: "Demo" },
          { kind: "pane", fn: "other", title: "Other" },
        ],
      }),
    ).toThrow(/two pane surfaces/);
  });

  it("rejects entries that escape the plugin folder", () => {
    expect(() => parseManifest({ ...base, entry: "../main.typ" })).toThrow(/unsafe/);
    expect(() => parseManifest({ ...base, entry: "/main.typ" })).toThrow(/unsafe/);
  });

  it("rejects unknown surface kinds", () => {
    expect(() =>
      parseManifest({ ...base, surfaces: [{ kind: "overlay", fn: "main", title: "Demo" }] }),
    ).toThrow(/unknown kind/);
  });
});

describe("validatePatch", () => {
  const manifest = parseManifest({
    ...base,
    collections: {
      strokes: {
        fields: {
          color: { type: "string" },
          width: { type: "number" },
        },
      },
    },
  });

  it("keeps the runtime id on append without reporting it as undeclared", () => {
    const result = validatePatch(
      {
        state: [
          { op: "append", collection: "strokes", record: { id: "s1", color: "#b42828", width: 3 } },
        ],
      },
      manifest,
    );

    expect(result.errors).toEqual([]);
    expect(result.patch.state?.[0]).toEqual({
      op: "append",
      collection: "strokes",
      record: { color: "#b42828", width: 3, id: "s1" },
    });
  });

  it("reports undeclared fields and keeps declared ones", () => {
    const result = validatePatch(
      {
        state: [
          { op: "append", collection: "strokes", record: { id: "s1", color: "#fff", tilt: 4 } },
        ],
      },
      manifest,
    );

    expect(result.errors).toEqual(['field "strokes.tilt" is not declared']);
    expect(result.patch.state?.[0]).toEqual({
      op: "append",
      collection: "strokes",
      record: { color: "#fff", id: "s1" },
    });
  });

  it("drops ops into undeclared collections", () => {
    const result = validatePatch(
      { state: [{ op: "append", collection: "notes", record: { id: "n1" } }] },
      manifest,
    );

    expect(result.errors).toEqual(['collection "notes" is not declared']);
    expect(result.patch.state).toEqual([]);
  });

  it("carries view patches through untouched", () => {
    const result = validatePatch({ view: { selected: "2026-09-26" } }, manifest);

    expect(result.errors).toEqual([]);
    expect(result.patch.view).toEqual({ selected: "2026-09-26" });
  });
});

describe("pluginSlug", () => {
  it("turns an id into a path-safe slug", () => {
    expect(pluginSlug("local:My Calendar")).toBe("local-my-calendar");
    expect(pluginSlug("at://did:plc:abc/plugin/Notes")).toBe("at-did-plc-abc-plugin-notes");
  });
});
