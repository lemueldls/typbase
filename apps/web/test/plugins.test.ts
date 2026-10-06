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

  // A name the host does not implement used to be accepted and then skipped at
  // mount, so the author only ever saw a missing element.
  it("rejects a hostComponents name the host does not implement", () => {
    expect(() => parseManifest({ ...base, hostComponents: ["chart", "canvas"] })).toThrow(
      /no such component: chart/,
    );
  });

  it("accepts the components the host implements", () => {
    expect(parseManifest({ ...base, hostComponents: ["canvas"] }).hostComponents).toEqual([
      "canvas",
    ]);
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
          {
            op: "append",
            collection: "strokes",
            record: { id: "s1", color: "#fff", width: 2, tilt: 4 },
          },
        ],
      },
      manifest,
    );

    expect(result.errors).toEqual(['field "strokes.tilt" is not declared']);
    expect(result.patch.state?.[0]).toEqual({
      op: "append",
      collection: "strokes",
      record: { color: "#fff", width: 2, id: "s1" },
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

  // `optional` used to be parsed and then ignored, so an absent optional field
  // and an absent required one both reported "is not a string".
  describe("optional fields", () => {
    const optionalManifest = parseManifest({
      ...base,
      collections: {
        events: {
          fields: {
            title: { type: "string" },
            time: { type: "string", optional: true },
          },
        },
      },
    });

    it("accepts an append that omits an optional field", () => {
      const result = validatePatch(
        { state: [{ op: "append", collection: "events", record: { id: "e1", title: "Dentist" } }] },
        optionalManifest,
      );

      expect(result.errors).toEqual([]);
      expect(result.patch.state?.[0]).toEqual({
        op: "append",
        collection: "events",
        record: { title: "Dentist", id: "e1" },
      });
    });

    it("names a missing required field as missing, not as a type error", () => {
      const result = validatePatch(
        { state: [{ op: "append", collection: "events", record: { id: "e1" } }] },
        optionalManifest,
      );

      expect(result.errors).toEqual(['field "events.title" is required but was not given']);
    });

    it("still reports a wrong type on a present field", () => {
      const result = validatePatch(
        { state: [{ op: "append", collection: "events", record: { id: "e1", title: 7 } }] },
        optionalManifest,
      );

      expect(result.errors).toEqual(['field "events.title" is not a string']);
    });

    // A merge only carries what it changes, so it must not demand the whole
    // record again.
    it("lets a merge omit every field it is not touching", () => {
      const result = validatePatch(
        { state: [{ op: "merge", collection: "events", id: "e1", record: { time: "10:00" } }] },
        optionalManifest,
      );

      expect(result.errors).toEqual([]);
      expect(result.patch.state?.[0]).toEqual({
        op: "merge",
        collection: "events",
        id: "e1",
        record: { time: "10:00" },
      });
    });

    // An explicit `undefined` in a merge means "leave this field alone", which is
    // what the storage layer does with it too, so it is dropped quietly.
    it("treats an explicit undefined in a merge as no change", () => {
      const result = validatePatch(
        {
          state: [{ op: "merge", collection: "events", id: "e1", record: { title: undefined } }],
        },
        optionalManifest,
      );

      expect(result.errors).toEqual([]);
      expect(result.patch.state?.[0]).toEqual({
        op: "merge",
        collection: "events",
        id: "e1",
        record: {},
      });
    });

    it("rejects setting a required field to undefined", () => {
      const result = validatePatch(
        { state: [{ op: "set", collection: "events", id: "e1", key: "title", value: undefined }] },
        optionalManifest,
      );

      expect(result.errors).toEqual(['field "events.title" is required but was not given']);
      expect(result.patch.state).toEqual([]);
    });

    it("allows clearing an optional field with a set", () => {
      const result = validatePatch(
        { state: [{ op: "set", collection: "events", id: "e1", key: "time", value: undefined }] },
        optionalManifest,
      );

      expect(result.errors).toEqual([]);
    });
  });
});

describe("pluginSlug", () => {
  it("drops the local scheme so the path names the plugin", () => {
    expect(pluginSlug("local:My Calendar")).toBe("my-calendar");
    expect(pluginSlug("local:drawing")).toBe("drawing");
  });

  // Two authors can both publish a `notes` plugin, so a remote id keeps its
  // whole form and the path stays unique.
  it("keeps an atproto id whole", () => {
    expect(pluginSlug("at://did:plc:abc/plugin/Notes")).toBe("at-did-plc-abc-plugin-notes");
  });

  it("survives an id that slugifies to nothing", () => {
    expect(pluginSlug("local:")).toBe("plugin");
  });
});
