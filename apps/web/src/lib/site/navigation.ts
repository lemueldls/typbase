import type { Category, PageMeta, SitePageSettings, SiteSettings } from "@typbase/typing";

export interface SiteNavigationPage {
  id: string;
  title: string;
  url: string;
  updatedAt: number;
}

export interface SiteNavigationGroup {
  id: string | null;
  name: string;
  pages: SiteNavigationPage[];
}

/** The parts of a page and its site config that decide where it appears. */
export interface SiteNavigationEntry {
  page: Pick<PageMeta, "id" | "path" | "title" | "categoryId" | "updatedAt">;
  config: Pick<SitePageSettings, "title" | "hiddenFromNav">;
  visibility: "public" | "unlisted";
  url: string;
}

function navigationPage(entry: SiteNavigationEntry): SiteNavigationPage {
  return {
    id: entry.page.id,
    title: entry.config.title?.trim() || entry.page.title,
    url: entry.url,
    updatedAt: entry.page.updatedAt,
  };
}

/**
 * Groups public pages for the published navigation. Daily notes are a
 * timeline, not a category: they always form their own group at the end,
 * newest first, even when a category was left on an old daily page.
 */
export function buildSiteNavigation(
  entries: SiteNavigationEntry[],
  categories: Category[],
  navigation: SiteSettings["navigation"],
): SiteNavigationGroup[] {
  const visible = entries.filter(
    (entry) => entry.visibility === "public" && !entry.config.hiddenFromNav,
  );
  const daily = visible
    .filter((entry) => entry.page.path.startsWith("daily/"))
    .sort((left, right) => right.page.path.localeCompare(left.page.path));

  const byCategory = new Map<string | null, SiteNavigationEntry[]>();
  for (const entry of visible) {
    if (entry.page.path.startsWith("daily/")) continue;
    const key = entry.page.categoryId ?? null;
    const group = byCategory.get(key);
    if (group) group.push(entry);
    else byCategory.set(key, [entry]);
  }

  const groups: SiteNavigationGroup[] = [];
  for (const [categoryId, groupEntries] of byCategory) {
    const category = categoryId
      ? (categories.find((candidate) => candidate.id === categoryId) ?? null)
      : null;
    groups.push({
      id: categoryId,
      name: category?.name ?? (categoryId ? "Pages" : navigation === "top" ? "Pages" : "General"),
      pages: groupEntries.map(navigationPage),
    });
  }

  if (daily.length) {
    groups.push({
      id: "daily",
      name: "Daily",
      pages: daily.map(navigationPage),
    });
  }

  return groups;
}
