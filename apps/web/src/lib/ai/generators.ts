import type { WorkspaceStore } from "@typbase/storage";
import type { Section } from "@typbase/typing";
import type { SectionSpan } from "@typbase/wasm";

import { createProvider, type AiProvider, type ChatMessage } from "./providers";

export interface GenerationContext {
  store: WorkspaceStore;
  provider: AiProvider;
  pageId: string;
  pageText: string;
  /** Typst source of the current selection, when scoped to one. */
  selection?: string;
}

async function chat(provider: AiProvider, system: string, user: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const answer = await provider.chat(messages);
  const trimmed = answer
    .replace(/^```typst\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  if (!trimmed) throw new Error("The provider returned an empty result");

  return trimmed;
}

const DOC_STYLE = `You write Typst markup for a local-first knowledge base. Return only Typst source: no explanations, no code fences. Use headings, lists, and bold/emphasis.`;

export async function generateSummary(
  ctx: GenerationContext,
  scope: "selection" | "page",
): Promise<string> {
  const source = scope === "selection" ? (ctx.selection ?? ctx.pageText) : ctx.pageText;
  if (!source.trim()) throw new Error("Nothing to summarize");

  return chat(
    ctx.provider,
    DOC_STYLE,
    `Summarize the following ${scope} in 3-6 short bullets. Start with the heading "= Summary".\n\n${source.slice(0, 12000)}`,
  );
}

export async function generateOutline(
  ctx: GenerationContext,
  scope: "selection" | "page",
): Promise<string> {
  const source = scope === "selection" ? (ctx.selection ?? ctx.pageText) : ctx.pageText;
  if (!source.trim()) throw new Error("Nothing to outline");

  return chat(
    ctx.provider,
    DOC_STYLE,
    `Produce a hierarchical outline of the following ${scope} using == and === headings plus nested list items. Start with the heading "= Outline".\n\n${source.slice(0, 12000)}`,
  );
}

export async function generateExplain(ctx: GenerationContext): Promise<string> {
  if (!ctx.selection?.trim()) throw new Error("Select some text first");

  return chat(
    ctx.provider,
    DOC_STYLE,
    `Explain the following Typst source to a curious reader: what each part does, in 2-4 short paragraphs. Start with the heading "= Explanation".\n\n${ctx.selection.slice(0, 8000)}`,
  );
}

export async function generateSimplify(ctx: GenerationContext): Promise<string> {
  if (!ctx.selection?.trim()) throw new Error("Select some text first");

  return chat(
    ctx.provider,
    DOC_STYLE,
    `Rewrite the following in simpler language, keeping every fact. Return the revision as a short paragraph, no heading.\n\n${ctx.selection.slice(0, 8000)}`,
  );
}

export async function generateFlashcards(ctx: GenerationContext): Promise<string> {
  const source = ctx.selection || ctx.pageText;
  if (!source.trim()) throw new Error("Nothing to turn into flashcards");

  return chat(
    ctx.provider,
    DOC_STYLE +
      ` The output MUST be exactly one block of this shape: #typbase.section(kind: "flashcards")[\n  == <card title>\n  Q: <question>\n  A: <answer>\n  // one == per card, 6-12 cards\n]`,
    `Make flashcards from this content. Front: a question. Back: the answer, 1-2 sentences.\n\n${source.slice(0, 12000)}`,
  );
}

export async function generateQuiz(ctx: GenerationContext): Promise<string> {
  const source = ctx.selection || ctx.pageText;
  if (!source.trim()) throw new Error("Nothing to quiz on");

  return chat(
    ctx.provider,
    DOC_STYLE +
      ` The output MUST be exactly: #typbase.section(kind: "quiz")[ ... ] containing 5 questions as == headings, each with a list of options and an "Answer:" line with the correct choice.`,
    `Create a short quiz from this content.\n\n${source.slice(0, 12000)}`,
  );
}

export async function generateStudyGuide(
  provider: AiProvider,
  categoryName: string,
  pages: Array<{ title: string; text: string }>,
): Promise<string> {
  const joined = pages
    .map((page) => `## ${page.title}\n${page.text}`)
    .join("\n\n")
    .slice(0, 20000);

  return chat(
    provider,
    DOC_STYLE +
      ` The output MUST start with "= Study guide: ${categoryName}" and contain a "= Key concepts" section, a "= Connections between notes" section, and a "= Practice questions" section wrapped in #typbase.section(kind: "quiz")[ ... ].`,
    `Stitch the following notes into a study guide.\n\n${joined}`,
  );
}

export async function generateDailyBrief(provider: AiProvider, dailyText: string): Promise<string> {
  return chat(
    provider,
    DOC_STYLE + ` The output MUST start with "= Morning briefing". Be terse: 3-5 bullets.`,
    `Write a morning briefing from this daily note source: what happened, what is next.\n\n${dailyText.slice(0, 8000)}`,
  );
}

export function createProviderFor(
  store: WorkspaceStore,
  keys: { openai?: string; anthropic?: string },
) {
  return createProvider(store.getAiConfig(), keys);
}

/** Maps wasm section spans to the stored `Section` shape (id, ranges, text). */
export function toSections(spans: SectionSpan[], source: string): Section[] {
  return spans.map((span) => ({
    id: `${span.kind}:${span.content_start}`,
    kind: span.kind,
    rangeStart: span.content_start,
    rangeEnd: span.content_end,
    title: span.title,
    text: source.slice(span.content_start, span.content_end),
  }));
}

/** Re-extracts `#typbase.section` spans into the page doc after content changes.
 *  The extractor returns null when the engine cannot run; the stored sections
 *  stay as they are rather than being wiped. */
export async function refreshSections(
  store: WorkspaceStore,
  pageId: string,
  text: string,
  extract: (source: string) => Section[] | null | Promise<Section[] | null>,
): Promise<void> {
  const sections = await extract(text);
  if (!sections) return;

  await store.setSections(pageId, sections);
}
