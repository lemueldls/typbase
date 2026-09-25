import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";

import type { ProviderMessage } from "./providers";

/**
 * Grounding context for a model turn. Two layers:
 *
 * - The dialect card is static: the app's Typst library plus the shapes
 *   `#typbase.query` answers with, straight from the engine and the shared
 *   types. It is what keeps the model inside this app's Typst rather than
 *   inventing functions.
 * - The dynamic layer is workspace facts: page index, categories, search
 *   hits, and the open page or selection. It is what grounds answers in the
 *   user's notes instead of the model's priors.
 *
 * Everything is char-budgeted, highest value first, so a huge workspace does
 * not blow the context window.
 */

export interface SearchHitLike {
  pageId: string;
  title: string;
  /** Plain-text excerpt around the match, if the search layer has one. */
  text: string;
}

export interface ContextDeps {
  store: WorkspaceStore;
  /** The main-thread engine, used for the real `lib.typ` source. */
  typstState: TypstState;
  search?: (query: string) => Promise<SearchHitLike[]>;
}

export interface ContextRequest {
  prompt: string;
  pageId: string | null;
  selection: string | null;
  includePage: boolean;
  includeSearch: boolean;
  /** Character budget for the dynamic sections; defaults to 24k. */
  budget?: number;
}

export interface ContextPack {
  system: string;
  /** Page ids that contributed context, for the UI's citation chips. */
  citations: string[];
}

const DIALECT_RULES = `## Output rules

You write Typst for Typbase, a local-first knowledge base. Reply with Typst
source only: no Markdown fences, no commentary outside the document. The app
compiles your reply and renders it; a reply that does not compile is sent back
to you with the compiler's diagnostics.

Use only the app functions below plus Typst's own markup and standard library.
Do not invent \`#typbase.*\` functions. Do not \`#import\` anything except
preview packages that are installed in this workspace. Prefer:
- \`= Heading\`, lists, bold/emphasis for structure;
- \`$\` math \`$\` for formulas;
- \`\`\`\`raw blocks\`\`\`\` for code;
- \`#typbase.page-link("<id>")\` to link a note by its real id;
- \`#typbase.embed("<id>")\` to include another note;
- \`#typbase.section(kind: "...")[ ... ]\` for a named block other tools read.
Keep replies concise. When the user asks about their notes, use the workspace
context and cite page titles rather than inventing content.`;

const QUERY_SHAPES = `## \`#typbase.query\` kinds and shapes

\`#typbase.query(kind, filter: none)\` returns decoded JSON:

- \`"config"\` -> \`{ name, homePageId, font }\`
- \`"pages"\` -> \`Array<{ id, path, title, kind, categoryId, tags, createdAt,
  updatedAt, pinned, publishedAt, publishUri }>\`; filter \`by-category/<id>\`
  or \`by-id/<id>\` returns a single page object for by-id.
- \`"categories"\` -> \`Array<{ id, name }>\`
- \`"daily"\` -> page array for all daily notes; filter by \`<YYYY-MM>\`
- \`"backlinks"\` -> pages with a link call to the current page (\`page-link\`,
  \`embed\`, or a \`typbase://page/\` URL)
- \`"sections"\` -> all pages with their flattened blocks
- \`"content"\` -> a page's text; filter by page id or daily date
- \`"plugin-data"\` -> one plugin instance's stored collections`;

function librarySource(typstState: TypstState): string {
  try {
    return typstState.typbaseLib();
  } catch {
    return [
      '#let query(kind, filter: none) = json("/typbase/query/" + kind + ".json")',
      '#let embed(id) = include("/typbase/src/" + str(id) + ".typ")',
      "#let page-link(page-id, body: none) = [#page-id]",
      "#let section(kind: none, body) = body",
    ].join("\n");
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);

  return `${cut}\n… [truncated ${text.length - max} characters]`;
}

/** The static dialect card; the engine's own library is the contract. */
export function dialectCard(typstState: TypstState): string {
  return [
    "## The Typbase Typst library (the only app API)",
    "",
    "```typst",
    librarySource(typstState).trim(),
    "```",
    "",
    QUERY_SHAPES,
    "",
    DIALECT_RULES,
  ].join("\n");
}

export async function buildContext(
  deps: ContextDeps,
  request: ContextRequest,
): Promise<ContextPack> {
  const store = deps.store;
  const citations: string[] = [];
  const sections: string[] = [];
  let budget = request.budget ?? 24_000;
  const spend = (section: string): void => {
    if (budget <= 0) return;
    sections.push(section);
    budget -= section.length;
  };

  // Current page or selection: the strongest grounding, spent first.
  if (request.includePage && request.pageId && store.getPage(request.pageId)) {
    const title = store.getPage(request.pageId)?.title ?? request.pageId;
    if (request.selection?.trim()) {
      spend(
        `## Selected Typst (from "${title}")\n\n\`\`\`typst\n${clip(request.selection, 8_000)}\n\`\`\``,
      );
    } else {
      const text = await store.loadPageText(request.pageId);
      spend(
        `## Open note "${title}" (id \`${request.pageId}\`)\n\n\`\`\`typst\n${clip(text, 12_000)}\n\`\`\``,
      );
    }
    citations.push(request.pageId);
  }

  // Search hits for the prompt: grounding for questions about the notes.
  if (request.includeSearch && deps.search && request.prompt.trim()) {
    try {
      const hits = await deps.search(request.prompt);
      if (hits.length) {
        const lines = hits.slice(0, 6).map((hit) => {
          citations.push(hit.pageId);
          return `### ${hit.title} (id \`${hit.pageId}\`)\n${clip(hit.text.trim(), 1_200)}`;
        });
        spend(`## Related notes from search\n\n${lines.join("\n\n")}`);
      }
    } catch {
      // Search is optional; a failure just means less context.
    }
  }

  // The page index: ids the model may link, and the workspace's shape.
  const pages = store.listPages();
  const categories = store.listCategories();
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const pageLines = pages
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 200)
    .map((page) => {
      const category = page.categoryId ? categoryName.get(page.categoryId) : undefined;
      return `- ${page.title} (id \`${page.id}\`${category ? `, ${category}` : ""})`;
    });
  spend(
    `## Workspace\n\n${pages.length} note(s), ${categories.length} categor${categories.length === 1 ? "y" : "ies"}${
      categories.length ? `: ${categories.map((category) => category.name).join(", ")}` : ""
    }\n\n${pageLines.join("\n")}`,
  );

  // The dialect card goes last: the model reads it right before answering.
  sections.push(dialectCard(deps.typstState));

  return { system: sections.join("\n\n"), citations: [...new Set(citations)] };
}

/** The system message a repair turn uses: contract plus the failing source. */
export function repairMessages(input: {
  typstState: TypstState;
  source: string;
  diagnostics: string;
}): ProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        dialectCard(input.typstState),
        "",
        "## Repair task",
        "",
        "The Typst document below failed to compile. Return the whole corrected",
        "document as Typst source only. Fix exactly the reported problems; keep",
        "everything else, including the user's intent and structure.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Diagnostics:\n\n${input.diagnostics}\n\nSource:\n\n\`\`\`typst\n${input.source}\n\`\`\``,
    },
  ];
}
