import type { PageKind, PageMeta } from "@typbase/typing";

import type { LinkRecord } from "~/lib/links";

/**
 * Graph data prep: pages plus link records in, nodes and deduplicated edges
 * out. Pure and unit-tested; the canvas only lays out and draws what this
 * returns, and the filters live in `WorkspaceSettings.graph`.
 */

export interface GraphNode {
  id: string;
  title: string;
  kind: PageKind;
  categoryId: string | null;
  tags: string[];
  /** Daily notes are pages; the flag drives the label tooltip. */
  daily: boolean;
  /** Undirected degree in the filtered graph. */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Link calls between the pair; parallel mentions collapse to one edge. */
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Link calls counted into edges, dangling targets excluded. */
  links: number;
}

export interface GraphFilters {
  /** Center of the local graph. */
  rootId?: string | null;
  /** Restrict to the root's neighborhood. */
  local?: boolean;
  /** Neighborhood radius in link hops. */
  depth?: number;
  categoryId?: string | null;
  tag?: string | null;
  /** Keep pages with no visible edges. */
  showOrphans?: boolean;
}

export function buildGraph(
  pages: PageMeta[],
  links: Iterable<LinkRecord>,
  filters: GraphFilters = {},
): GraphData {
  const local = Boolean(filters.local && filters.rootId);
  const depth = Math.max(1, filters.depth ?? 1);
  const showOrphans = filters.showOrphans ?? true;

  // Candidates after the category and tag filters. The local root stays in
  // even when a filter would hide it: an empty graph reads as broken.
  const candidates = new Map<string, PageMeta>();
  for (const page of pages) {
    if (filters.categoryId && page.categoryId !== filters.categoryId) continue;
    if (filters.tag && !page.tags.includes(filters.tag)) continue;

    candidates.set(page.id, page);
  }
  if (local && filters.rootId && !candidates.has(filters.rootId)) {
    const root = pages.find((page) => page.id === filters.rootId);
    if (root) candidates.set(root.id, root);
  }

  // Undirected adjacency over the candidates, with parallel calls counted.
  const adjacency = new Map<string, Set<string>>();
  const weights = new Map<string, number>();
  const neighborsOf = (id: string): Set<string> => {
    const existing = adjacency.get(id);
    if (existing) return existing;

    const created = new Set<string>();
    adjacency.set(id, created);

    return created;
  };
  const addEdge = (a: string, b: string) => {
    if (a === b || !candidates.has(a) || !candidates.has(b)) return;

    neighborsOf(a).add(b);
    neighborsOf(b).add(a);
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  };

  let linkCount = 0;
  for (const link of links) {
    if (!link.targetId) continue;
    if (!candidates.has(link.sourceId) || !candidates.has(link.targetId)) continue;
    if (link.sourceId === link.targetId) continue;
    linkCount += 1;
    addEdge(link.sourceId, link.targetId);
  }

  // Local mode keeps the root and everything within `depth` hops.
  let visible: Set<string>;
  if (local && filters.rootId) {
    visible = new Set([filters.rootId]);
    let frontier = [filters.rootId];
    for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (visible.has(neighbor)) continue;
          visible.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  } else {
    visible = new Set(candidates.keys());
  }

  if (!showOrphans) {
    for (const id of [...visible]) {
      if (id === filters.rootId && local) continue;
      if ((adjacency.get(id)?.size ?? 0) === 0) visible.delete(id);
    }
  }

  const nodes: GraphNode[] = [...visible]
    .flatMap((id) => {
      const page = candidates.get(id);
      if (!page) return [];

      return [
        {
          id,
          title: page.title,
          kind: page.kind,
          categoryId: page.categoryId,
          tags: page.tags,
          daily: page.path.startsWith("daily/"),
          degree: adjacency.get(id)?.size ?? 0,
        },
      ];
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  const edges: GraphEdge[] = [];
  for (const [key, weight] of weights) {
    const [a, b] = key.split("\u0000");
    if (a === undefined || b === undefined) continue;
    if (!visible.has(a) || !visible.has(b)) continue;

    edges.push({ source: a, target: b, weight });
  }
  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

  return { nodes, edges, links: linkCount };
}
