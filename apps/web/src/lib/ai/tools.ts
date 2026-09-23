import type { WorkspaceStore } from "@typbase/storage";

import type { SearchHitLike } from "./context";
import type { AiToolDefinition } from "./providers";

/**
 * Read-only workspace tools the model may call before answering. Retrieval
 * beats stuffing every note into the prompt, and every call is inspectable in
 * the thread, which is the point: the user can see what the answer was
 * grounded in.
 *
 * The set is deliberately read-only. Writes go through explicit user actions
 * (insert, create page), never through a model tool.
 */

export interface ToolContext {
  store: WorkspaceStore;
  search?: (query: string) => Promise<SearchHitLike[]>;
}

export const WORKSPACE_TOOLS: AiToolDefinition[] = [
  {
    name: "search_notes",
    description:
      "Full-text search across the workspace's notes. Returns matching notes with an excerpt.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for." },
        limit: { type: "integer", description: "Maximum results (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description: "Read one note's raw Typst source by its page id.",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "The note id from search_notes or list_notes." },
      },
      required: ["pageId"],
    },
  },
  {
    name: "list_notes",
    description: "List notes with their ids, categories, and paths. Optionally filter by category.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id to filter by." },
      },
    },
  },
];

const READ_LIMIT = 8_000;

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export async function runWorkspaceTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<string> {
  const args = asRecord(input);
  const store = context.store;

  try {
    switch (name) {
      case "search_notes": {
        const query = String(args.query ?? "").trim();
        if (!query) return JSON.stringify({ error: "query is required" });

        if (context.search) {
          const hits = await context.search(query);
          const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
          return JSON.stringify(
            hits.slice(0, limit).map((hit) => ({
              pageId: hit.pageId,
              title: hit.title,
              excerpt: hit.text.slice(0, 700),
            })),
          );
        }

        // Fallback when the index is not running: case-insensitive scan.
        const needle = query.toLowerCase();
        const matches: Array<{ pageId: string; title: string; excerpt: string }> = [];
        for (const page of store.listPages()) {
          if (matches.length >= 5) break;
          const text = await store.loadPageText(page.id);
          const index = text.toLowerCase().indexOf(needle);
          if (index < 0) continue;
          matches.push({
            pageId: page.id,
            title: page.title,
            excerpt: text.slice(Math.max(0, index - 200), index + 500),
          });
        }

        return JSON.stringify(matches);
      }

      case "read_note": {
        const pageId = String(args.pageId ?? "");
        const page = store.getPage(pageId);
        if (!page) return JSON.stringify({ error: `no note with id ${pageId}` });

        const text = await store.loadPageText(pageId);
        return JSON.stringify({
          pageId,
          title: page.title,
          path: page.path,
          source: text.slice(0, READ_LIMIT),
          truncated: text.length > READ_LIMIT,
        });
      }

      case "list_notes": {
        const category = args.category ? String(args.category) : null;
        const names = new Map(store.listCategories().map((entry) => [entry.id, entry.name]));
        const pages = store
          .listPages()
          .filter((page) => !category || page.categoryId === category)
          .map((page) => ({
            pageId: page.id,
            title: page.title,
            path: page.path,
            category: page.categoryId ? (names.get(page.categoryId) ?? page.categoryId) : null,
            updatedAt: page.updatedAt,
          }));

        return JSON.stringify(pages.slice(0, 200));
      }

      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}
