import { describe, expect, it } from "vitest";

import { buildSiteNavigation, type SiteNavigationEntry } from "../src/lib/site/navigation";

function entry(
  id: string,
  path: string,
  options: {
    categoryId?: string | null;
    title?: string;
    visibility?: "public" | "unlisted";
    hiddenFromNav?: boolean;
  } = {},
): SiteNavigationEntry {
  return {
    page: {
      id,
      path,
      title: options.title ?? id,
      categoryId: options.categoryId ?? null,
      updatedAt: 1,
    },
    config: { hiddenFromNav: options.hiddenFromNav },
    visibility: options.visibility ?? "public",
    url: `/${id}/`,
  };
}

describe("published site navigation", () => {
  it("keeps daily notes out of categories and sorts them newest first", () => {
    const groups = buildSiteNavigation(
      [
        entry("new-day", "daily/2026-10-02.typ"),
        entry("old-day", "daily/2026-10-01.typ", { categoryId: "work" }),
        entry("general", "pages/about.typ"),
        entry("work-page", "pages/project.typ", { categoryId: "work" }),
        entry("unlisted", "pages/secret.typ", { visibility: "unlisted" }),
        entry("hidden", "pages/hidden.typ", { hiddenFromNav: true }),
      ],
      [
        { id: "work", name: "Work" },
        { id: "empty", name: "Empty" },
      ],
      "sidebar",
    );

    expect(groups.map((group) => group.name)).toEqual(["General", "Work", "Daily"]);
    expect(groups[0]?.pages.map((page) => page.id)).toEqual(["general"]);
    expect(groups[1]?.pages.map((page) => page.id)).toEqual(["work-page"]);
    expect(groups[2]?.pages.map((page) => page.id)).toEqual(["new-day", "old-day"]);
  });

  it("does not emit an empty Daily group", () => {
    const groups = buildSiteNavigation([entry("general", "pages/about.typ")], [], "sidebar");

    expect(groups.map((group) => group.name)).toEqual(["General"]);
  });
});
