import type { FlattenedBlock } from "@typbase/engine";

import { describe, expect, it } from "vitest";

import { findInPrepared, preparePageBlocks } from "../src/lib/pageFind";

const encoder = new TextEncoder();

function blockFor(source: string, plain: string, start = source.indexOf(plain)): FlattenedBlock {
  const map: number[] = [];
  let byte = encoder.encode(source.slice(0, start)).length;

  for (const char of plain) {
    const length = encoder.encode(char).length;
    for (let offset = 0; offset < length; offset++) map.push(byte + offset);
    byte += length;
  }

  return {
    kind: "paragraph",
    plain,
    range_start: encoder.encode(source.slice(0, start)).length,
    range_end: byte,
    map,
  };
}

/** A block whose plain text skips markup in the source. */
function blockWithOffsets(source: string, plain: string, starts: number[]): FlattenedBlock {
  const map: number[] = [];
  let index = 0;
  let end = 0;

  for (const char of plain) {
    const start = starts[index] ?? 0;
    const startByte = encoder.encode(source.slice(0, start)).length;
    const length = encoder.encode(char).length;
    for (let offset = 0; offset < length; offset++) map.push(startByte + offset);
    end = startByte + length;
    index++;
  }

  return {
    kind: "paragraph",
    plain,
    range_start: encoder.encode(source.slice(0, starts[0] ?? 0)).length,
    range_end: end,
    map,
  };
}

describe("find in page", () => {
  it("finds every occurrence in source order", () => {
    const source = "= Café\n\nA café and a cafe.";
    const blocks = [blockFor(source, "Café"), blockFor(source, "A café and a cafe.")];
    const matches = findInPrepared(preparePageBlocks(blocks, source), "cafe", source);

    expect(matches.map((match) => source.slice(match.from, match.to))).toEqual([
      "Café",
      "café",
      "cafe",
    ]);
  });

  it("ignores case and accents", () => {
    const source = "Café résumé";
    const matches = findInPrepared(
      preparePageBlocks([blockFor(source, source)], source),
      "CAFE RESUME",
      source,
    );

    expect(matches).toHaveLength(1);
    expect(source.slice(matches[0]?.from, matches[0]?.to)).toBe("Café résumé");
  });

  it("keeps offsets correct after an emoji", () => {
    const source = "😀 hello world";
    const matches = findInPrepared(
      preparePageBlocks([blockFor(source, "hello world")], source),
      "world",
      source,
    );

    expect(matches).toHaveLength(1);
    expect(source.slice(matches[0]?.from, matches[0]?.to)).toBe("world");
  });

  it("does not match markup that flattening removed", () => {
    const source = "= Title\n\nA *bold* word.";
    const block = blockWithOffsets(
      source,
      "A bold word.",
      [9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22],
    );
    const matches = findInPrepared(preparePageBlocks([block], source), "bold", source);

    expect(matches).toHaveLength(1);
    expect(source.slice(matches[0]?.from, matches[0]?.to)).toBe("bold");
  });

  it("returns nothing for an empty query", () => {
    const source = "text";
    expect(
      findInPrepared(preparePageBlocks([blockFor(source, source)], source), "  ", source),
    ).toEqual([]);
  });

  it("caps a page at the match limit", () => {
    const source = "a".repeat(20);
    const matches = findInPrepared(
      preparePageBlocks([blockFor(source, source)], source),
      "a",
      source,
      5,
    );

    expect(matches).toHaveLength(5);
  });
});
