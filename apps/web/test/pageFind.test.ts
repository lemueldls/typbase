import type { FrameText, FrameTextGlyph, FrameTextRun } from "@typbase/engine";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIND_OPTIONS,
  findInPage,
  findInSource,
  mergeFindHits,
  prepareFrameText,
  prepareSourceText,
  replacementFor,
  sourceHash,
} from "../src/lib/pageFind";

const SOURCE = "Hello café world alpha + x^2 #let value = 1";

/**
 * One glyph per UTF-16 unit, so test assertions can treat the glyph boxes as a
 * per-character map. Real runs differ, but the mapping rules are the same.
 */
function glyphs(text: string, sourceFrom: number, sourceTo: number, x = 0): FrameTextGlyph[] {
  const out: FrameTextGlyph[] = [];
  let unit = 0;

  for (const char of text) {
    const start = unit;
    unit += char.length;
    const perCharacter = sourceTo - sourceFrom === text.length;
    out.push({
      start,
      end: unit,
      from: perCharacter ? sourceFrom + start : sourceFrom,
      to: perCharacter ? sourceFrom + unit : sourceTo,
      x: x + start * 10,
      width: 10,
    });
  }

  return out;
}

function run(text: string, sourceFrom: number, sourceTo: number, x = 0, y = 0): FrameTextRun {
  return {
    text,
    x,
    y,
    width: text.length * 10,
    height: 12,
    glyphs: glyphs(text, sourceFrom, sourceTo, x),
  };
}

function pageText(): FrameText {
  return {
    source_hash: 0,
    frames: [
      {
        from: 0,
        to: 16,
        runs: [run("Hello café world", 0, 16)],
      },
      {
        from: 17,
        to: 28,
        runs: [
          run("𝛼", 17, 22, 0, 0),
          run("+", 23, 24, 10, 0),
          run("𝑥", 25, 26, 20, 0),
          run("2", 27, 28, 30, 0),
        ],
      },
      {
        from: 29,
        to: SOURCE.length,
        runs: [run("#let value = 1", 29, SOURCE.length, 0, 0)],
      },
    ],
  };
}

describe("page find", () => {
  it("hashes source like the engine", () => {
    expect(sourceHash("")).toBe(0x811c9dc5);
    expect(sourceHash("a")).toBe(0xe40c292c);
    expect(sourceHash("abc")).toBe(0x1a47e90b);
  });

  it("matches rendered prose by case and accent", () => {
    const page = prepareFrameText(pageText());
    const hits = findInPage(page, "CAFE");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.source).toEqual({ from: 6, to: 10 });
    expect(SOURCE.slice(hits[0]?.source?.from, hits[0]?.source?.to)).toBe("café");
    expect(hits[0]?.marks[0]?.rects).toHaveLength(1);
  });

  it("matches across frame boundaries", () => {
    const page = prepareFrameText(pageText());
    const hits = findInPage(page, "world 𝛼");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.marks.map((mark) => mark.frameIndex)).toEqual([0, 1]);
  });

  it("matches math glyphs and keeps their source command", () => {
    const page = prepareFrameText(pageText());
    const hits = findInPage(page, "𝛼");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.source).toEqual({ from: 17, to: 22 });
    expect(SOURCE.slice(hits[0]?.source?.from, hits[0]?.source?.to)).toBe("alpha");
  });

  it("matches code text in page scope", () => {
    const page = prepareFrameText(pageText());
    const hits = findInPage(page, "value");

    expect(hits).toHaveLength(1);
    expect(SOURCE.slice(hits[0]?.source?.from, hits[0]?.source?.to)).toBe("value");
  });

  it("merges the page and source passes into one hit", () => {
    const page = prepareFrameText(pageText());
    const source = prepareSourceText(SOURCE);
    const hits = mergeFindHits(findInSource(page, source, "value"), findInPage(page, "value"));

    expect(hits).toHaveLength(1);
    expect(hits[0]?.source).toEqual({ from: 34, to: 39 });
    expect(hits[0]?.marks.length).toBeGreaterThan(0);
  });

  it("marks rendered glyphs for a source-only query", () => {
    const page = prepareFrameText(pageText());
    const hits = findInSource(page, prepareSourceText(SOURCE), "alpha");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.marks).toHaveLength(1);
    expect(hits[0]?.marks[0]?.frameIndex).toBe(1);
    expect(hits[0]?.marks[0]?.rects.length).toBeGreaterThan(0);
  });

  it("finds markup that has no separate glyph", () => {
    const page = prepareFrameText(pageText());
    const hits = findInSource(page, prepareSourceText(SOURCE), "#let");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.source).toEqual({ from: 29, to: 33 });
  });

  it("honors match case and whole word", () => {
    const page = prepareFrameText(pageText());
    const source = prepareSourceText(SOURCE);
    const caseSensitive = { ...DEFAULT_FIND_OPTIONS, matchCase: true };
    const wholeWord = { ...DEFAULT_FIND_OPTIONS, wholeWord: true };

    expect(findInPage(page, "CAFE", caseSensitive)).toHaveLength(0);
    expect(findInPage(page, "café", caseSensitive)).toHaveLength(1);
    expect(findInSource(page, source, "caf", wholeWord)).toHaveLength(0);
    expect(findInSource(page, source, "café", wholeWord)).toHaveLength(1);
  });

  it("matches regular expressions in both passes", () => {
    const page = prepareFrameText(pageText());
    const source = prepareSourceText(SOURCE);
    const regexp = { ...DEFAULT_FIND_OPTIONS, regexp: true };

    expect(findInPage(page, "w.rld", regexp)).toHaveLength(1);
    expect(findInSource(page, source, "al.ha", regexp)).toHaveLength(1);
    expect(findInSource(page, source, "[", regexp)).toEqual([]);
  });

  it("expands capture groups in regexp replacements", () => {
    const page = prepareFrameText(pageText());
    const regexp = { ...DEFAULT_FIND_OPTIONS, regexp: true };
    const hit = findInSource(page, prepareSourceText(SOURCE), "(value)", regexp)[0]!;

    expect(replacementFor(SOURCE, hit, "(value)", "[$1]", regexp)).toBe("[value]");
    expect(replacementFor(SOURCE, hit, "(value)", "<$&>", regexp)).toBe("<value>");
    expect(replacementFor(SOURCE, hit, "value", "$1", DEFAULT_FIND_OPTIONS)).toBe("$1");
  });

  it("returns nothing for an empty query", () => {
    const page = prepareFrameText(pageText());

    expect(findInPage(page, "  ")).toEqual([]);
    expect(findInSource(page, prepareSourceText(SOURCE), "  ")).toEqual([]);
  });

  it("caps a page at the match limit", () => {
    const page = prepareFrameText(pageText());
    expect(findInPage(page, "o", DEFAULT_FIND_OPTIONS, 2)).toHaveLength(2);
    expect(
      findInSource(page, prepareSourceText(SOURCE), "l", DEFAULT_FIND_OPTIONS, 2),
    ).toHaveLength(2);
  });
});
