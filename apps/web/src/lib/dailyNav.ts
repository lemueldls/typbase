import type { PageMeta } from "@typbase/typing";

/**
 * The daily notes next to a date, for the prelude's page context. Paths are
 * ISO dates (`daily/2026-09-27.typ`), so string order is date order. Resolving
 * this from the live page list is what lets a note created before its next day
 * link to it later; creation-time placeholders cannot.
 */

/** The ISO date of a daily note path, or null for anything else. */
export function dailyDate(path: string): string | null {
  if (!path.startsWith("daily/") || !path.endsWith(".typ")) return null;

  const value = path.slice("daily/".length, -".typ".length);

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function dailyNeighbors(
  pages: ReadonlyArray<Pick<PageMeta, "id" | "path">>,
  date: string,
): { previous: string | null; next: string | null } {
  const dated: Array<{ id: string; date: string }> = [];
  for (const page of pages) {
    const value = dailyDate(page.path);
    if (!value) continue;

    dated.push({ id: page.id, date: value });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date));

  let previous: string | null = null;
  let next: string | null = null;
  for (const entry of dated) {
    if (entry.date < date) previous = entry.id;
    else if (entry.date > date && next === null) next = entry.id;
  }

  return { previous, next };
}
