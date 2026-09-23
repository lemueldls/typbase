import type { SectionSpan } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { Section } from "@typbase/typing";

/** Section extraction helpers. These are plain Typst-AST work, not AI. */

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
