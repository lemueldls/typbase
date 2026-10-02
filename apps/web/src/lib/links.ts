import type { LinkSpan } from "@typbase/engine";

export type { LinkSpan };
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

/**
 * Link records, backlinks, and the incremental link index.
 *
 * The engine's `extractLinks` pass finds the calls. This module resolves them
 * against the page list, keeps the context line the UI shows, and answers both
 * directions of a page's links. Calls whose target is computed at compile time
 * (`#typbase.page-link(page.id)` in a query loop) stay unresolved until a
 * surface asks for them. The injected `DynamicLinkResolver` compiles the page
 * and the resolved ids merge into the same records, so backlinks, the graph,
 * and `#typbase.query("backlinks")` all see them. Nothing here imports wasm or
 * Vue, so the pure helpers unit-test in node. The app supplies the extractor
 * and resolver through `lib/linkIndex.ts`.
 */

/** One link call resolved against the workspace. */
export interface LinkRecord extends LinkSpan {
  /** Page the call sits in. */
  sourceId: string;
  /** Resolved target page id. Null when nothing matches (dangling). */
  targetId: string | null;
  /** Context line around the call, for backlink lists. */
  snippet: LinkSnippet;
  /**
   * A dynamic call showing targets from an earlier compile, because the page was
   * re-extracted or the page set moved and the re-resolve has not landed yet.
   * The row is real but its target may be out of date, so surfaces that show it
   * say so instead of blanking and refilling.
   */
  pending: boolean;
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

/** Resolves one page source into link spans, the engine pass in the app. */
export type LinkExtractor = (text: string) => LinkSpan[] | Promise<LinkSpan[]>;

/**
 * Compiles one page and returns the page ids its rendered links point at.
 * Only called for pages with dynamic calls, and only while a surface wants
 * them. See `lib/linkIndex.ts` for the worker-backed implementation.
 */
export type DynamicLinkResolver = (pageId: string, source: string) => Promise<string[]>;

export interface LinkStatus {
  /** False until the first sweep finishes. */
  ready: boolean;
  pages: number;
  links: number;
  /** Wanted pages waiting on a resolution, stale ones included. */
  pending: number;
  /** Page the resolver is compiling, if any. */
  resolving: string | null;
  /** Last extraction failure. The index keeps serving stale records. */
  error: string | null;
}

/** Longest context line a snippet keeps before it windows around the link. */
const SNIPPET_MAX = 160;
/** Debounce between a page change and its re-extraction. */
const FLUSH_DEBOUNCE_MS = 400;
/** Idle gap before the resolver starts compiling the wanted pages. */
const RESOLVE_DEBOUNCE_MS = 150;

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
    pending: false,
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

/**
 * Pairs resolved target ids with the dynamic call spans that produced them.
 *
 * A loop compiles many targets from one call site, so those targets share the
 * call's span: the mention reveals the loop line and the panel groups them by
 * page anyway. When a page has exactly one dynamic call per target, the two
 * lists pair in source order, which keeps a page with two separate calls
 * pointing each target at the right line.
 */
export function resolveDynamicRecords(spans: LinkRecord[], targets: string[]): LinkRecord[] {
  const first = spans[0];
  if (!first) return [];

  if (spans.length === targets.length) {
    return targets.map((target, index) => ({
      ...(spans[index] ?? first),
      target,
      targetId: target,
    }));
  }

  return targets.map((target) => ({ ...first, target, targetId: target }));
}

/** Page ids a rendered document links to, in order, deduplicated. */
export function extractPageTargets(html: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="typbase:\/\/page\/([^"]+)"/g)) {
    const target = match[1];
    if (!target || seen.has(target)) continue;

    seen.add(target);
    targets.push(target);
  }

  return targets;
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
 * excluded) and misses dynamic targets. The engine pass is the real one.
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
        dynamic: false,
      });
    }
  }

  return spans.sort((a, b) => a.from - b.from);
}

/**
 * Incremental link index for one workspace.
 *
 * An initial sweep extracts every page. Content changes re-extract only the
 * changed pages (through the store's commit batches), and page-set changes
 * re-resolve the whole workspace because an id or path shift can turn
 * dangling links into real ones. Records are per-session data: a reload
 * rebuilds them from the sources.
 *
 * Dynamic calls are resolved separately and only for the pages a surface
 * asks for (`setWanted`), one compile at a time. Resolved targets merge into
 * `allRecords()` so backlinks and the graph see them. A page/category change
 * marks every resolution stale and re-resolves in place, so the old targets
 * keep answering until the fresh ones land.
 */
export class LinkIndex {
  private readonly store: WorkspaceStore;
  private readonly extract: LinkExtractor;
  private readonly resolve?: DynamicLinkResolver;
  private readonly onInvalidate?: () => void;
  private pages = new Map<string, PageMeta>();
  /** source page -> its link records, in source order. */
  private records = new Map<string, LinkRecord[]>();
  /** source page -> page ids its dynamic calls compiled to. */
  private resolved = new Map<string, string[]>();
  /**
   * Resolved pages whose query data moved. They keep serving their old
   * targets until the re-resolve lands, so the graph does not flicker while
   * the resolver catches up.
   */
  private stale = new Set<string>();
  /**
   * Surface -> the pages it wants resolved. The union drives the queue. A
   * null set means every pending page, which the panel needs because backlinks
   * come from pages it does not know yet.
   */
  private wanted = new Map<symbol, Set<string> | null>();
  private incoming = new Map<string, LinkRecord[]>();
  private dirty = new Set<string>();
  private listeners = new Set<() => void>();
  private unsubscribes: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private resolveTimer: ReturnType<typeof setTimeout> | undefined;
  private resolving: string | null = null;
  private started = false;
  private statusValue: LinkStatus = {
    ready: false,
    pages: 0,
    links: 0,
    pending: 0,
    resolving: null,
    error: null,
  };

  constructor(
    store: WorkspaceStore,
    extract: LinkExtractor,
    resolve?: DynamicLinkResolver,
    onInvalidate?: () => void,
  ) {
    this.store = store;
    this.extract = extract;
    this.resolve = resolve;
    this.onInvalidate = onInvalidate;
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
      // Page metadata and categories decide what the query loops see, so a
      // change there invalidates every resolved dynamic target.
      this.store.onWorkspaceChange([["pages"], ["categories"]], () => this.invalidateResolved()),
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
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.resolveTimer = undefined;
    this.listeners.clear();
    this.started = false;
    this.dirty.clear();
    this.resolved.clear();
    this.stale.clear();
    this.wanted.clear();
  }

  /** Re-extracts everything when the engine comes back from a trap. */
  retry(): void {
    for (const id of this.pages.keys()) this.dirty.add(id);
    for (const id of this.resolved.keys()) this.stale.add(id);
    this.scheduleFlush();
    this.scheduleResolution();
  }

  /**
   * Declares the pages one surface needs resolved, replacing its last set.
   * Omitting `ids` wants every pending page, now and as the sweep finds more.
   * The queue is the union across surfaces, so a closed panel cannot cancel
   * work the graph still wants.
   */
  setWanted(owner: symbol, ids?: Iterable<string>): void {
    this.wanted.set(owner, ids === undefined ? null : new Set(ids));
    this.scheduleResolution();
  }

  clearWanted(owner: symbol): void {
    this.wanted.delete(owner);
  }

  /** Pages with dynamic calls that no compile has resolved yet. */
  pendingDynamic(): string[] {
    const out: string[] = [];
    for (const [pageId, records] of this.records) {
      // A stale page counts as pending even though it has an answer: it is
      // waiting for a fresh one, and dropping it here would leave it showing its
      // old targets as pending forever.
      if (
        records.some((record) => record.dynamic) &&
        (!this.resolved.has(pageId) || this.stale.has(pageId))
      ) {
        out.push(pageId);
      }
    }

    return out;
  }

  /**
   * Outgoing links of one page, resolved dynamic targets included.
   *
   * A dynamic call with no target at all is still hidden, since there is nothing
   * to show for it. One that has a target keeps its row while a re-resolve is
   * pending, marked `pending`, so the panel does not blank and refill on every
   * edit. The target is the last resolution's, which is what the flag says.
   */
  recordsFor(pageId: string): LinkRecord[] {
    return this.mergedRecords(pageId)
      .filter((record) => !record.dynamic || record.targetId)
      .map((record) => ({
        ...record,
        pending: record.dynamic && this.stale.has(pageId),
      }));
  }

  /**
   * All records with resolved dynamic targets, for the graph and queries.
   *
   * Stale targets are excluded here: backlinks and the graph answer "what links
   * where", and a stale answer is worse than no answer for a query result.
   */
  allRecords(): LinkRecord[] {
    const out: LinkRecord[] = [];
    for (const pageId of this.records.keys()) out.push(...this.mergedRecords(pageId));

    return out.filter((record) => !record.dynamic || record.targetId);
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

  /** Diffs the page list. A changed id/path set invalidates resolution. */
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
    // Records for deleted pages would keep answering backlinks with a page
    // that no longer exists.
    for (const id of this.records.keys()) {
      if (next.has(id)) continue;

      this.records.delete(id);
      this.resolved.delete(id);
      this.stale.delete(id);
    }
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

  /** Serializes flushes. Work that lands mid-flush is picked up by the next. */
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
      this.updateStatus();
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
        // The source moved, so the resolved targets describe the old text. They
        // keep answering until the re-resolve lands, which is what
        // `invalidateResolved` does for a page-set change: dropping them made the
        // panel's rows disappear and come back on every edit.
        if (this.resolved.has(id)) this.stale.add(id);
        else this.stale.delete(id);
        this.statusValue.error = null;
      } catch (error) {
        this.statusValue.error = error instanceof Error ? error.message : String(error);
        this.records.set(id, []);
      }
    }

    this.recomputeIncoming();
    this.updateStatus();
    this.emit();
    this.scheduleResolution();
  }

  /**
   * The page's extracted records plus one record per resolved dynamic target.
   * Targets a static call already covers are skipped: the compile cannot say
   * which call produced which anchor.
   */
  private mergedRecords(pageId: string): LinkRecord[] {
    const records = this.records.get(pageId) ?? [];
    const targets = this.resolved.get(pageId);
    if (!targets || targets.length === 0) return records;

    const dynamicSpans = records.filter((record) => record.dynamic);
    if (dynamicSpans.length === 0) return records;

    const staticTargets = new Set(
      records
        .filter((record) => !record.dynamic && record.targetId)
        .map((record) => record.targetId),
    );
    const fresh = targets.filter((target) => !staticTargets.has(target));
    if (fresh.length === 0) return records;

    return [...records, ...resolveDynamicRecords(dynamicSpans, fresh)].sort(
      (a, b) => a.from - b.from,
    );
  }

  /**
   * Marks every resolved target stale and tells the resolver its cache is
   * stale. The old targets keep answering until the re-resolve lands, so a
   * page added to a category does not blank the graph for a beat.
   */
  private invalidateResolved(): void {
    this.onInvalidate?.();
    for (const pageId of this.resolved.keys()) this.stale.add(pageId);
    if (this.stale.size > 0) this.scheduleResolution();
  }

  private updateStatus(): void {
    this.statusValue.ready = true;
    this.statusValue.pages = this.pages.size;
    this.statusValue.links = this.countLinks();
    // Only wanted pages count as pending: a local graph leaves pages outside
    // its view unresolved on purpose, and the hint must not wait for them.
    let pending = 0;
    for (const id of this.effectiveWanted()) {
      if (this.hasDynamic(id) && (!this.resolved.has(id) || this.stale.has(id))) pending += 1;
    }
    this.statusValue.pending = pending;
    this.statusValue.resolving = this.resolving;
  }

  private recomputeIncoming(): void {
    this.incoming = backlinkIndex(this.allRecords());
  }

  private countLinks(): number {
    // `allRecords` is resolved-only, so a stale re-resolve does not move the
    // count the panel header shows.
    return this.allRecords().length;
  }

  /** Union of every surface's wanted pages. Null sets mean all pending. */
  private effectiveWanted(): Set<string> {
    const out = new Set<string>();
    for (const ids of this.wanted.values()) {
      const resolvedIds = ids ?? this.pendingDynamic();
      for (const id of resolvedIds) out.add(id);
    }

    return out;
  }

  private hasDynamic(pageId: string): boolean {
    return (this.records.get(pageId) ?? []).some((record) => record.dynamic);
  }

  private scheduleResolution(): void {
    if (!this.resolve || this.resolveTimer || this.resolving) return;

    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = undefined;
      void this.runResolution();
    }, RESOLVE_DEBOUNCE_MS);
  }

  /** Compiles the next wanted page with dynamic calls, then schedules the rest. */
  private async runResolution(): Promise<void> {
    const resolve = this.resolve;
    if (!resolve || this.resolving) return;

    const wanted = this.effectiveWanted();
    // Stale pages first: their old targets are on screen and the fresh ones
    // matter more than a page nobody has resolved yet.
    const next =
      [...this.stale].find((id) => wanted.has(id) && this.hasDynamic(id)) ??
      [...wanted].find((id) => !this.resolved.has(id) && this.hasDynamic(id));
    if (next === undefined) return;

    this.resolving = next;
    this.updateStatus();
    this.emit();

    try {
      const source = await this.store.loadPageText(next);
      const targets = await resolve(next, source);
      // A surface that lost interest mid-compile does not keep the result.
      if (this.effectiveWanted().has(next)) this.resolved.set(next, targets);
      this.stale.delete(next);
      this.statusValue.error = null;
    } catch (error) {
      // Nothing to show, but mark it done so a failing page cannot spin the
      // queue. The next page change clears the entry and tries again.
      this.resolved.set(next, []);
      this.stale.delete(next);
      this.statusValue.error = error instanceof Error ? error.message : String(error);
      console.warn(`[links] resolving ${next} failed:`, error);
    } finally {
      this.resolving = null;
      this.recomputeIncoming();
      this.updateStatus();
      this.emit();
      if (this.effectiveWanted().size > 0) this.scheduleResolution();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
