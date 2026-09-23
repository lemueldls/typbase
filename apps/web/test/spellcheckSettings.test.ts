import { describe, expect, it } from "vitest";

import {
  addDictionaryWord,
  addIgnoredLint,
  dictionaryWord,
  ignoredLintsJson,
  normalizeDictionaryWords,
} from "../src/lib/spellcheckSettings";

/**
 * The settings-side spellcheck conversions. Harper's formats are the tricky
 * part: u64 hashes that overflow JS numbers, and a dictionary that should
 * treat case variants as one word.
 */

describe("normalizeDictionaryWords", () => {
  it("trims, drops empties, and skips non-strings", () => {
    expect(normalizeDictionaryWords(["  Typst ", "", "  ", 42, null, "Loro"])).toEqual([
      "Typst",
      "Loro",
    ]);
  });

  it("dedupes case-insensitively and keeps the first casing", () => {
    expect(normalizeDictionaryWords(["Typst", "typst", "TYPST"])).toEqual(["Typst"]);
  });

  it("handles a missing list", () => {
    expect(normalizeDictionaryWords(undefined)).toEqual([]);
  });
});

describe("addDictionaryWord", () => {
  it("appends a new word", () => {
    expect(addDictionaryWord(["Typst"], "Loro")).toEqual(["Typst", "Loro"]);
  });

  it("does not append a case variant", () => {
    expect(addDictionaryWord(["Typst"], "typst")).toEqual(["Typst"]);
  });
});

describe("ignoredLintsJson", () => {
  const entry = { hash: "12", kind: "Grammar", message: "message", text: "text" };

  it("builds Harper's context_hashes shape with raw u64 digits", () => {
    expect(ignoredLintsJson([{ ...entry, hash: "18446744073709551615" }])).toBe(
      '{"context_hashes":[18446744073709551615]}',
    );
  });

  it("skips non-digit hashes and duplicates", () => {
    expect(ignoredLintsJson([entry, { ...entry, message: "other" }, { ...entry, hash: "x" }])).toBe(
      '{"context_hashes":[12]}',
    );
  });

  it("emits an empty list when there is nothing to ignore", () => {
    expect(ignoredLintsJson([])).toBe('{"context_hashes":[]}');
  });
});

describe("dictionaryWord", () => {
  it("keeps a plain word", () => {
    expect(dictionaryWord("typoo")).toBe("typoo");
  });

  it("strips surrounding punctuation", () => {
    expect(dictionaryWord("“typoo,”")).toBe("typoo");
  });

  it("keeps internal hyphens and apostrophes", () => {
    expect(dictionaryWord("well-known")).toBe("well-known");
    expect(dictionaryWord("don’t")).toBe("don’t");
  });

  it("rejects phrases and empties", () => {
    expect(dictionaryWord("two words")).toBeNull();
    expect(dictionaryWord("  ")).toBeNull();
  });
});

describe("addIgnoredLint", () => {
  const entry = { hash: "42", kind: "Grammar", message: "message", text: "text" };

  it("appends an entry", () => {
    expect(addIgnoredLint([], entry)).toEqual([entry]);
  });

  it("keeps the same array when the hash is already there", () => {
    const existing = [entry];
    expect(addIgnoredLint(existing, { ...entry, message: "other" })).toBe(existing);
  });

  it("drops malformed hashes", () => {
    expect(addIgnoredLint([], { ...entry, hash: "not-a-hash" })).toEqual([]);
  });
});
