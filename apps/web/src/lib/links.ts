import type { LinkSpan } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

/**
 * Link records, backlinks, and the incremental link index.
 *
 * The engine's `extractLinks` pass finds the calls; this module resolves them
 * against the page list, keeps the context line the UI shows, and answers both
 * directions of a page's links. Nothing here imports wasm or Vue, so the pure
 * helpers unit-test in node; the app supplies the extractor through
 * `lib/linkIndex.ts`.
 */

/** One link call resolved against the workspace. */
export interface LinkRecord extends LinkSpan {
  /** Page the call sits in. */
  sourceId: string;
  /** Resolved target page id; null when nothing matches (dangling). */
  targetId: string | null;
  /** Context line around the call, for backlink lists. */
  snippet: LinkSnippet;
}

/** A line of source around a link, with the link's range inside it. */
export interface LinkSnippet {
  text: string;
  from: number;
  to: number;
}

/** Backlinks grouped by the page that links the target. */
export interface BacklinkGroup {
  pageId: string;
  mentions: LinkRecord[];
}

/** Resolves one page source into link spans; the engine pass in the app. */
export type LinkExtractor = (text: string) => LinkSpan[] | Promise<LinkSpan[]>;

export interface LinkStatus {
  /** False until the first sweep finishes. */
  ready: boolean;
  pages: number;
  links: number;
  /** Last extraction failure; the index keeps serving stale records. */
  error: string | null;
}

/** Longest context line a snippet keeps before it windows around the link. */
const SNIPPET_MAX = 160;
/** Debounce between a page change and its re-extraction. */
const FLUSH_DEBOUNCE_MS = 400;

/** id and path variants -> page id, for resolving link targets. */
export function linkTargets(pages: PageMeta[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const page of pages) {
    targets.set(page.id, page.id);
    targets.set(page.path, page.id);
    if (page.path.endsWith(".typ")) targets.set(page.path.slice(0, -4), page.id);
  }

  return targets;
}

/** Resolves raw spans from one page into records with snippets. */
export function toLinkRecords(
  sourceId: string,
  spans: LinkSpan[],
  targets: Map<string, string>,
  source: string,
): LinkRecord[] {
  return spans.map((span) => ({
    ...span,
    sourceId,
    targetId: targets.get(span.target.trim()) ?? null,
    snippet: linkSnippet(source, span.from, span.to),
  }));
}

/**
 * The source line around a link, trimmed and windowed to `max`. `from`/`to`
 * are UTF-16 offsets into the snippet, so callers can split the text there.
 * Ellipses mark a windowed or trimmed edge.
 */
export function linkSnippet(
  source: string,
  from: number,
  to: number,
  max = SNIPPET_MAX,
): LinkSnippet {
  const lineStart = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  let lineEnd = source.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = source.length;

  let start = lineStart;
  let end = lineEnd;
  if (end - start > max) {
    const pad = Math.max(0, Math.floor((max - (to - from)) / 2));
    start = Math.max(lineStart, from - pad);
    end = Math.min(lineEnd, start + max);
    start = Math.max(lineStart, end - max);
  }

  let text = source.slice(start, end);
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  if (trailing > 0) text = text.slice(0, text.length - trailing);
  text = text.slice(leading);

  const prefix = start > lineStart ? "…" : "";
  const suffix = end < lineEnd ? "…" : "";
  const shift = prefix.length - leading;

  return {
    text: `${prefix}${text}${suffix}`,
    from: Math.max(0, from - start + shift),
    to: Math.max(0, to - start + shift),
  };
}

/** Inverts source records into target -> records, dropping dangling links. */
export function backlinkIndex(records: Iterable<LinkRecord>): Map<string, LinkRecord[]> {
  const byTarget = new Map<string, LinkRecord[]>();
  for (const record of records) {
    if (!record.targetId) continue;

    const list = byTarget.get(record.targetId);
    if (list) list.push(record);
    else byTarget.set(record.targetId, [record]);
  }

  return byTarget;
}

/** Reads every page source and extracts its links. */
export async function scanPageLinks(
  store: WorkspaceStore,
  pages: PageMeta[],
  extract: LinkExtractor,
): Promise<Map<string, LinkRecord[]>> {
  const targets = linkTargets(pages);
  const out = new Map<string, LinkRecord[]>();

  for (const page of pages) {
    // Sequential on purpose: one parse at a time keeps the wasm heap steady.
    // eslint-disable-next-line no-await-in-loop
    const text = await store.loadPageText(page.id);
    // eslint-disable-next-line no-await-in-loop
    const spans = await extract(text);
    out.set(page.id, toLinkRecords(page.id, spans, targets, text));
  }

  return out;
}

/** Backlinks as ids: target page id -> source page ids. */
export async function workspaceBacklinks(
  store: WorkspaceStore,
  pages: PageMeta[],
  extract: LinkExtractor,
): Promise<Map<string, Set<string>>> {
  const records = await scanPageLinks(store, pages, extract);
  const incoming = backlinkIndex([...records.values()].flat());
  const out = new Map<string, Set<string>>();
  for (const [targetId, list] of incoming) {
    out.set(targetId, new Set(list.map((record) => record.sourceId)));
  }

  return out;
}

/**
 * Regex extraction for degraded mode: the engine is failed, or a query lands
 * before the index starts. It over-matches (comments and raw blocks are not
 * excluded) and misses dynamic targets; the engine pass is the real one.
 */
export function extractLinksFallback(text: string): LinkSpan[] {
  const patterns: Array<{ kind: string; re: RegExp }> = [
    { kind: "page-link", re: /#typbase\.page-link\(\s*"([^"]*)"/g },
    { kind: "embed", re: /#typbase\.embed\(\s*"([^"]*)"/g },
    { kind: "url", re: /#link\(\s*"typbase:\/\/page\/([^"]*)"/g },
  ];

  const spans: LinkSpan[] = [];
  for (const { kind, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const target = match[1];
      if (target === undefined || target === "" || match.index === undefined) continue;

      const openQuote = match[0].indexOf('"');
      const prefix = kind === "url" ? "typbase://page/".length : 0;
      const targetFrom = match.index + openQuote + 1 + prefix;

      spans.push({
        kind,
        target,
        from: match.index,
        to: match.index + match[0].length,
        target_from: targetFrom,
        target_to: targetFrom + target.length,
      });
    }
  }

  return spans.sort((a, b) => a.from - b.from);
}

/**
 * Incremental link index for one workspace.
 *
 * An initial sweep extracts every page; content changes re-extract only the
 * changed pages (through the store's commit batches), and page-set changes
 * re-resolve the whole workspace because an id or path shift can turn
 * dangling links into real ones. Records are per-session data: a reload
 * rebuilds them from the sources.
 */
export class LinkIndex {
  private readonly store: WorkspaceStore;
  private readonly extract: LinkExtractor;
  private pages = new Map<string, PageMeta>();
  /** source page -> its link records, in source order. */
  private records = new Map<string, LinkRecord[]>();
  private incoming = new Map<string, LinkRecord[]>();
  private dirty = new Set<string>();
  private listeners = new Set<() => void>();
  private unsubscribes: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private started = false;
  private statusValue: LinkStatus = { ready: false, pages: 0, links: 0, error: null };

  constructor(store: WorkspaceStore, extract: LinkExtractor) {
    this.store = store;
    this.extract = extract;
  }

  get workspaceId(): string {
    return this.store.workspaceId;
  }

  get status(): LinkStatus {
    return this.statusValue;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;

    this.unsubscribes.push(
      this.store.onLocalCommit((docId) => {
        if (this.pages.has(docId)) this.markDirty(docId);
      }),
      this.store.onStructureChange(() => this.refreshPages()),
    );

    this.refreshPages();
    for (const id of this.pages.keys()) this.dirty.add(id);

    return this.flush();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.listeners.clear();
    this.started = false;
    this.dirty.clear();
  }

  /** Re-extracts everything; used when the engine comes back from a trap. */
  retry(): void {
    for (const id of this.pages.keys()) this.dirty.add(id);
    this.scheduleFlush();
  }

  /** Outgoing links of one page. */
  recordsFor(pageId: string): LinkRecord[] {
    return this.records.get(pageId) ?? [];
  }

  /** All records, newest extraction first per page, for the graph. */
  allRecords(): LinkRecord[] {
    return [...this.records.values()].flat();
  }

  /** Backlinks grouped by source page, sorted by title. */
  backlinksFor(pageId: string): BacklinkGroup[] {
    const records = this.incoming.get(pageId) ?? [];
    const groups = new Map<string, LinkRecord[]>();
    for (const record of records) {
      const group = groups.get(record.sourceId);
      if (group) group.push(record);
      else groups.set(record.sourceId, [record]);
    }

    return [...groups.entries()]
      .map(([sourceId, mentions]) => ({ pageId: sourceId, mentions }))
      .sort((a, b) => this.title(a.pageId).localeCompare(this.title(b.pageId)));
  }

  private title(pageId: string): string {
    return this.pages.get(pageId)?.title ?? pageId;
  }

  /** Diffs the page list; a changed id/path set invalidates resolution. */
  private refreshPages(): void {
    const next = new Map(this.store.listPages().map((page) => [page.id, page]));
    let resolutionChanged = next.size !== this.pages.size;

    if (!resolutionChanged) {
      for (const [id, page] of next) {
        const previous = this.pages.get(id);
        if (!previous || previous.path !== page.path) {
          resolutionChanged = true;
          break;
        }
      }
    }

    this.pages = next;
    if (resolutionChanged) {
      for (const id of next.keys()) this.dirty.add(id);
    }
    this.scheduleFlush();
  }

  private markDirty(pageId: string): void {
    this.dirty.add(pageId);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Serializes flushes; work that lands mid-flush is picked up by the next. */
  private flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = undefined;
      if (this.dirty.size > 0) this.scheduleFlush();
    });

    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const ids = [...this.dirty].filter((id) => this.pages.has(id));
    this.dirty.clear();
    if (ids.length === 0) {
      this.statusValue.ready = true;
      this.statusValue.pages = this.pages.size;
      this.statusValue.links = this.countLinks();
      this.emit();

      return;
    }

    const targets = linkTargets([...this.pages.values()]);
    for (const id of ids) {
      const page = this.pages.get(id);
      if (!page) continue;

      try {
        // eslint-disable-next-line no-await-in-loop
        const text = await this.store.loadPageText(id);
        // eslint-disable-next-line no-await-in-loop
        const spans = await this.extract(text);
        this.records.set(id, toLinkRecords(id, spans, targets, text));
        this.statusValue.error = null;
      } catch (error) {
        this.statusValue.error = error instanceof Error ? error.message : String(error);
        this.records.set(id, []);
      }
    }

    this.recomputeIncoming();
    this.statusValue.ready = true;
    this.statusValue.pages = this.pages.size;
    this.statusValue.links = this.countLinks();
    this.emit();
  }

  private recomputeIncoming(): void {
    this.incoming = backlinkIndex(this.allRecords());
  }

  private countLinks(): number {
    let count = 0;
    for (const records of this.records.values()) count += records.length;

    return count;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
