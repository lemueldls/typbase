import { describe, expect, it } from "vitest";

import { pageContext, typstContextValue } from "../src/lib/pageContext";

const pages = [
  { id: "home", path: "home.typ" },
  { id: "thu", path: "daily/2026-09-24.typ" },
  { id: "fri", path: "daily/2026-09-25.typ" },
  { id: "sat", path: "daily/2026-09-26.typ" },
];

const base = {
  id: "sat",
  title: "Saturday, Sep 26, 2026",
  path: "daily/2026-09-26.typ",
  kind: "document" as const,
  categoryId: null as string | null,
  tags: ["journal"],
};

function note(overrides: Partial<typeof base> = {}) {
  return { ...base, ...overrides };
}

describe("pageContext", () => {
  it("reads the daily neighbors from the live page list", () => {
    expect(pageContext(pages, note())).toMatchObject({
      id: "sat",
      date: "2026-09-26",
      previous: "fri",
      next: null,
      tags: ["journal"],
      category: null,
    });
  });

  it("leaves date and neighbors empty for a plain page", () => {
    const context = pageContext(
      pages,
      note({ id: "home", title: "Home", path: "home.typ", categoryId: "reading" }),
    );

    expect(context).toMatchObject({
      date: null,
      previous: null,
      next: null,
      category: "reading",
    });
  });
});

describe("typstContextValue", () => {
  it("renders a Typst dictionary with none for empty fields", () => {
    const value = typstContextValue(pageContext(pages, note()));

    expect(value).toContain('title: "Saturday, Sep 26, 2026"');
    expect(value).toContain("category: none");
    expect(value).toContain('date: "2026-09-26"');
    expect(value).toContain('previous: "fri"');
    expect(value).toContain("next: none");
    expect(value).toContain('tags: ("journal",)');
  });

  it("escapes quotes and backslashes", () => {
    const value = typstContextValue(pageContext(pages, note({ title: 'A "quoted" \\ title' })));

    expect(value).toContain('title: "A \\"quoted\\" \\\\ title"');
  });
});
