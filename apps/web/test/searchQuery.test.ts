import { describe, expect, it } from "vitest";

import { buildSearchQuery } from "../src/lib/searchQuery";

describe("search query builder", () => {
  it("returns null for an empty query", () => {
    expect(buildSearchQuery("")).toBeNull();
    expect(buildSearchQuery("   ")).toBeNull();
  });

  it("prefixes unquoted terms", () => {
    expect(buildSearchQuery("typ")?.strict).toBe('("typ"*)');
    expect(buildSearchQuery("typ")?.loose).toBeNull();
  });

  it("keeps a one-character term exact", () => {
    expect(buildSearchQuery("a")?.strict).toBe('("a")');
  });

  it("joins multiple terms with AND", () => {
    expect(buildSearchQuery("typ search")?.strict).toBe('("typ"* "search"*)');
    expect(buildSearchQuery("typ search")?.loose).toBe('("typ"* OR "search"*)');
  });

  it("keeps quoted phrases exact", () => {
    expect(buildSearchQuery('"typ search"')?.strict).toBe('("typ search")');
    expect(buildSearchQuery('"typ search"')?.loose).toBeNull();
  });

  it("excludes terms", () => {
    expect(buildSearchQuery("typ -draft")?.strict).toBe('("typ"*) NOT ("draft"*)');
    expect(buildSearchQuery('typ -"old draft"')?.strict).toBe('("typ"*) NOT ("old draft")');
  });

  it("ignores exclusions without a positive term", () => {
    expect(buildSearchQuery("-draft")).toBeNull();
  });

  it("treats an unclosed quote as a phrase", () => {
    expect(buildSearchQuery('"typ search')?.strict).toBe('("typ search")');
  });

  it("keeps punctuation inside a quoted term", () => {
    expect(buildSearchQuery("C++")?.strict).toBe('("C++"*)');
    expect(buildSearchQuery("atproto's")?.strict).toBe('("atproto\'s"*)');
  });

  it("drops terms with no letters or numbers", () => {
    expect(buildSearchQuery("++")).toBeNull();
    expect(buildSearchQuery("++ --")).toBeNull();
  });

  it("caps the number of terms", () => {
    const input = Array.from({ length: 12 }, (_, index) => `term${index}`).join(" ");
    const query = buildSearchQuery(input);

    expect(query?.positive).toHaveLength(8);
    expect(query?.strict.split('"').length).toBe(17);
  });

  it("deduplicates terms", () => {
    expect(buildSearchQuery("typ typ")?.strict).toBe('("typ"*)');
  });
});
