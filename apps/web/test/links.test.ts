import { describe, expect, it } from "vitest";

import type { LinkRecord } from "../src/lib/links";

import { extractPageTargets, resolveDynamicRecords, toLinkRecords } from "../src/lib/links";

/** A record as the extractor leaves a dynamic call: span only, no target. */
function dynamicSpan(from: number, to: number): LinkRecord {
  return {
    kind: "page-link",
    target: "",
    from,
    to,
    target_from: from + 18,
    target_to: to - 1,
    dynamic: true,
    sourceId: "source",
    targetId: null,
    snippet: { text: "#typbase.page-link(page.id)", from: 0, to: 28 },
    pending: false,
  };
}

describe("resolveDynamicRecords", () => {
  it("points every target at the loop that produced it", () => {
    const records = resolveDynamicRecords([dynamicSpan(10, 40)], ["a", "b"]);
    expect(records.map((record) => record.targetId)).toEqual(["a", "b"]);
    expect(records.every((record) => record.from === 10 && record.to === 40)).toBe(true);
    expect(records.every((record) => record.dynamic)).toBe(true);
  });

  it("pairs targets with calls when the counts line up", () => {
    const records = resolveDynamicRecords([dynamicSpan(0, 20), dynamicSpan(30, 50)], ["a", "b"]);
    expect(records.map((record) => [record.targetId, record.from])).toEqual([
      ["a", 0],
      ["b", 30],
    ]);
  });

  it("falls back to the first call when a loop makes more targets than calls", () => {
    const records = resolveDynamicRecords(
      [dynamicSpan(0, 20), dynamicSpan(30, 50)],
      ["a", "b", "c"],
    );
    expect(records.map((record) => record.targetId)).toEqual(["a", "b", "c"]);
    expect(records.every((record) => record.from === 0)).toBe(true);
  });

  it("returns nothing without a span", () => {
    expect(resolveDynamicRecords([], ["a"])).toEqual([]);
  });
});

describe("extractPageTargets", () => {
  it("reads page hrefs in order without duplicates", () => {
    const html =
      '<a href="typbase://page/a">A</a>' +
      '<a href="typbase://page/b">B</a>' +
      '<a href="typbase://page/a">A</a>';

    expect(extractPageTargets(html)).toEqual(["a", "b"]);
  });

  it("ignores links that are not page links", () => {
    expect(extractPageTargets('<a href="https://typst.app">x</a>')).toEqual([]);
  });
});

describe("toLinkRecords", () => {
  it("keeps a dynamic call with a null target and its call snippet", () => {
    const source = "#typbase.page-link(page.id)\n";
    const records = toLinkRecords(
      "source",
      [
        {
          kind: "page-link",
          target: "",
          from: 0,
          to: source.trimEnd().length,
          target_from: "#typbase.page-link(".length,
          target_to: source.trimEnd().length - 1,
          dynamic: true,
        },
      ],
      new Map(),
      source,
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.dynamic).toBe(true);
    expect(records[0]?.targetId).toBeNull();
    expect(records[0]?.snippet.text).toBe("#typbase.page-link(page.id)");
  });
});
