import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

import { dailyDate, dailyNeighbors } from "~/lib/dailyNav";

/**
 * The page a compile belongs to, as Typst data. The prelude carries it as
 * `note`, so a note renders its own title, path, and daily
 * neighbors without creation-time placeholder substitution and without the
 * file cache a query would need. Every compile surface builds the binding for
 * the page it compiles: the editor, the render worker, the resolver, and the
 * export bundles, where it is inlined into each entry.
 */

export interface PageContext {
  id: string;
  title: string;
  path: string;
  kind: string;
  category: string | null;
  tags: string[];
  /** ISO date for a daily note, null otherwise. */
  date: string | null;
  /** Nearest daily note before this one, null when there is none. */
  previous: string | null;
  next: string | null;
}

/** Builds one page's context. Neighbors come from the live page list. */
export function pageContext(
  pages: ReadonlyArray<Pick<PageMeta, "id" | "path">>,
  page: Pick<PageMeta, "id" | "title" | "path" | "kind" | "categoryId" | "tags">,
): PageContext {
  const date = dailyDate(page.path);
  const neighbors = date ? dailyNeighbors(pages, date) : { previous: null, next: null };

  return {
    id: page.id,
    title: page.title,
    path: page.path,
    kind: page.kind,
    category: page.categoryId ?? null,
    tags: [...page.tags],
    date,
    previous: neighbors.previous,
    next: neighbors.next,
  };
}

/** The Typst dictionary literal for a context, without the `#let`. */
export function typstContextValue(context: PageContext): string {
  const fields = [
    `id: ${typstString(context.id)}`,
    `title: ${typstString(context.title)}`,
    `path: ${typstString(context.path)}`,
    `kind: ${typstString(context.kind)}`,
    `category: ${context.category ? typstString(context.category) : "none"}`,
    `tags: ${typstArray(context.tags)}`,
    `date: ${context.date ? typstString(context.date) : "none"}`,
    `previous: ${context.previous ? typstString(context.previous) : "none"}`,
    `next: ${context.next ? typstString(context.next) : "none"}`,
  ];

  return `(\n  ${fields.join(",\n  ")},\n)`;
}

/** The prelude binding for one context. */
export function typstContextBinding(context: PageContext): string {
  return `#let note = ${typstContextValue(context)}`;
}

/** The binding for a workspace page. Empty when the page is gone. */
export function pageContextBinding(store: WorkspaceStore, pageId: string | null): string {
  if (!pageId) return "";

  const page = store.getPage(pageId);
  if (!page) return "";

  return typstContextBinding(pageContext(store.listPages(), page));
}

function typstString(value: string): string {
  // Typst strings take \" and \\. Control characters would need \u{...} and
  // never belong in a title or tag, so collapse them to spaces.
  const clean = value.replace(/\p{Cc}/gu, " ");

  return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function typstArray(values: string[]): string {
  if (values.length === 0) return "()";

  return `(${values.map(typstString).join(", ")},)`;
}
