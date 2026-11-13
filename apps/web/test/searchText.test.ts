import type { FlattenedBlock } from "@typbase/engine";

import { describe, expect, it } from "vitest";

import {
  contentHash,
  foldText,
  rawEndForByte,
  utf16ByteOffsets,
  utf16MapForBlock,
} from "../src/lib/searchText";

const encoder = new TextEncoder();

/** A block whose plain text appears verbatim in the source. */
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

describe("foldText", () => {
  it("folds case and accents", () => {
    const folded = foldText("Café");

    expect(folded.text).toBe("cafe");
    expect(folded.map).toEqual([0, 1, 2, 3, 4]);
  });

  it("folds decomposed accents", () => {
    const folded = foldText("cafe\u0301");

    expect(folded.text).toBe("cafe");
    expect(folded.map).toEqual([0, 1, 2, 3, 5]);
  });

  it("keeps emoji offsets aligned", () => {
    const folded = foldText("😀é");

    expect(folded.text).toBe("😀e");
    expect(folded.map).toEqual([0, 0, 2, 3]);
  });

  it("keeps letters that are not diacritics", () => {
    expect(foldText("før").text).toBe("før");
    expect(foldText("Straße").text).toBe("straße");
  });
});

describe("contentHash", () => {
  it("changes with the text and stays stable for the same text", () => {
    expect(contentHash("first draft")).toBe(contentHash("first draft"));
    expect(contentHash("first draft")).not.toBe(contentHash("second draft"));
    expect(contentHash("")).toBe(contentHash(""));
  });
});

describe("utf16MapForBlock", () => {
  it("converts raw byte offsets to UTF-16 offsets", () => {
    const source = "= Café\n\nA café and a cafe.";
    const plain = "A café and a cafe.";
    const map = utf16MapForBlock(blockFor(source, plain), source);

    expect(map).toHaveLength(encoder.encode(plain).length + 1);
    expect(map[0]).toBe(8);
    expect(map[2]).toBe(10);
    expect(map[3]).toBe(11);
    expect(map.at(-1)).toBe(26);
  });

  it("counts an emoji before the block as two UTF-16 units", () => {
    const source = "😀 hello";
    const plain = "hello";
    const map = utf16MapForBlock(blockFor(source, plain), source);

    expect(map[0]).toBe(3);
    expect(map.at(-1)).toBe(8);
  });

  it("reuses the page byte offsets for every block", () => {
    const source = "Café\n\nAnother block";
    const offsets = utf16ByteOffsets(source);
    const first = blockFor(source, "Café");
    const second = blockFor(source, "Another block");

    expect(utf16MapForBlock(first, source, offsets)).toEqual(utf16MapForBlock(first, source));
    expect(utf16MapForBlock(second, source, offsets)).toEqual(utf16MapForBlock(second, source));
  });

  it("keeps a sentinel for an empty block", () => {
    expect(utf16MapForBlock(blockFor("text", "text"), "text").length).toBe(5);
    expect(
      utf16MapForBlock(
        { kind: "paragraph", plain: "", range_start: 0, range_end: 0, map: [] },
        "text",
      ).length,
    ).toBe(1);
  });

  it("ends at the last matched character", () => {
    const source = "A *bold* word.";
    const block = {
      kind: "paragraph",
      plain: "A bold word.",
      range_start: 0,
      range_end: source.length,
      map: [0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
    };
    const map = utf16MapForBlock(block, source);

    expect(rawEndForByte(map, source, 6)).toBe(7);
    expect(source.slice(map[2], rawEndForByte(map, source, 6))).toBe("bold");
  });
});
