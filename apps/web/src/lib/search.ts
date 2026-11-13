import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";

import type { IndexedBlock, IndexStatus, SearchHit } from "~/workers/index.worker";

import { useTypst } from "~/composables/typst";
import { blocksOf } from "~/lib/engineSyntax";
import { contentHash, rawEndForByte, utf16ByteOffsets, utf16MapForBlock } from "~/lib/searchText";

/**
 * Search manager: starts the index worker connection, feeds it flattened
 * blocks from the wasm syntax pass, and answers palette queries with a
 * hybrid (BM25 + optional semantic) merge. Indexing is incremental off the
 * store's commit batches, debounced, one transaction per page.
 */

/** A snippet split into plain and matched runs for the palette to render. */
export interface SnippetSegment {
  text: string;
  match: boolean;
}

export interface SearchResultItem {
  docId: string;
  path: string;
  title: string;
  blockIndex: number;
  kind: string;
  /** Snippet text split at the FTS match spans. */
  snippet: SnippetSegment[];
  /** Raw source range for the best hit in the block. */
  rawRange: { from: number; to: number } | null;
  /** FTS offsets within the block's plain text, in UTF-8 bytes. */
  offsets: Array<[number, number]>;
  bm25: number | null;
  semantic: number | null;
  /** Fused rank score, higher is better. */
  score: number;
}

/** A text query and whether it needed the any-word fallback. */
export interface SearchQueryResult {
  items: SearchResultItem[];
  loose: boolean;
}

/** Progress of the startup check, the first index pass, or a manual rebuild. */
export interface IndexProgress {
  done: number;
  total: number;
  reason: "checking" | "startup" | "rebuild";
}

export interface SearchStatus {
  ready: boolean;
  mode: "opfs" | "memory" | "starting";
  docs: number;
  blocks: number;
  semantic: boolean;
  /** sqlite-vec is present in this build. Semantic queries need it. */
  vecReady: boolean;
  model: "idle" | "downloading" | "ready" | "error";
  /** Download percentage while `model` is "downloading". Null when unknown. */
  modelProgress: number | null;
  error: string | null;
  /** Last index worker failure. Indexing is broken while this is set. */
  indexError: string | null;
  /** Set while the startup sweep or a rebuild is running. */
  indexing: IndexProgress | null;
}

const INDEX_DEBOUNCE_MS = 2000;
const QUERY_TIMEOUT_MS = 8000;
const MAX_HITS = 40;
/** Ceiling for one embedding call. The first one downloads the model. */
const EMBED_TIMEOUT_MS = 120_000;
/** Backoff between index worker load attempts. Vite's optimizer needs a moment. */
const WORKER_RETRY_DELAYS = [1000, 3000, 8000];

export type SearchQueryMode = "text" | "hybrid" | "loading" | "unavailable";

/** Text search always runs. Semantic only fuses in when the model is ready. */
export function searchQueryMode(status: SearchStatus | null): SearchQueryMode {
  if (!status?.semantic) return "text";
  if (!status.vecReady || status.model === "error") return "unavailable";

  return status.model === "ready" ? "hybrid" : "loading";
}

export class SearchManager {
  private worker: Worker | undefined;
  private embedWorker: Worker | undefined;
  private embedSeq = 0;
  private embedPending = new Map<number, (vectors: number[][] | null) => void>();
  private pendingDocs = new Set<string>();
  private indexMaps = new Map<string, Map<number, Uint32Array>>();
  /** Source text per indexed page, for turning a match end into an offset. */
  private indexedText = new Map<string, string>();
  /** Blocks from the last upsert, waiting for the worker's row ids. */
  private blocksByDoc = new Map<string, IndexedBlock[]>();
  private blockIds = new Map<string, number[]>();
  /** Last indexed `PageMeta.updatedAt`, so settings writes don't re-embed. */
  private indexedAt = new Map<string, number>();
  /** Content fingerprint the worker stored for each page. */
  private indexedHash = new Map<string, string>();
  /** The worker has answered with its page list. */
  private indexedReady = false;
  private indexErrors = new Map<string, string>();
  /** Set while the startup sweep or a rebuild runs. */
  private initialSweep: "startup" | "rebuild" | null = null;
  // FTS offsets are UTF-8 byte offsets. Snippets need the decoded text back.
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  // Debounce via the global useDebounceFn. Outside a component scope it never
  // auto-disposes, which is fine: the manager lives for the app's lifetime.
  private flushIndexDebounced = useDebounceFn(() => void this.flushIndex(), INDEX_DEBOUNCE_MS);
  private statusValue: SearchStatus = {
    ready: false,
    mode: "starting",
    docs: 0,
    blocks: 0,
    semantic: false,
    vecReady: false,
    model: "idle",
    modelProgress: null,
    error: null,
    indexError: null,
    indexing: null,
  };
  private listeners = new Set<() => void>();
  private typst: Promise<TypstState> | undefined;

  constructor(private readonly store: WorkspaceStore) {}

  /** The workspace this index belongs to. Switches rebuild the manager. */
  get workspaceId(): string {
    return this.store.workspaceId;
  }

  get status(): SearchStatus {
    return this.statusValue;
  }

  async start(): Promise<void> {
    this.startWorker();
    this.refreshSettings();

    this.store.onLocalCommit((docId) => {
      this.markDirty(docId);
    });
    this.store.onStructureChange(() => {
      // Search settings live in the workspace doc, so this is also where a
      // semantic-search flip lands. Every workspace-doc write fires this
      // event, and re-embedding the workspace on a theme change would be
      // wasteful, so only pages whose metadata actually moved get indexed.
      this.refreshSettings();
      this.markChanged();
      this.emit();
    });

    // The worker reports what it already has. Only changed or missing pages
    // are indexed, so a warm workspace opens without a full rebuild.
    this.syncIndexed();
  }

  /** Creates the index worker and hands it the database name. */
  private startWorker(attempt = 0): void {
    this.worker?.terminate();

    const worker = new Worker(new URL("../workers/index.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent) =>
      this.handleWorkerMessage(event.data),
    );
    worker.addEventListener("error", () => void this.restartWorker(attempt));
    worker.postMessage({ type: "init", dbName: this.store.workspaceId });
  }

  /**
   * The dev server's dependency optimizer can invalidate the worker module
   * while it loads (a 504 for the stale URL). The worker has the index, so a
   * restart starts empty: drop what was indexed and rebuild it.
   */
  private async restartWorker(attempt: number): Promise<void> {
    this.indexedReady = false;
    this.indexedAt.clear();
    this.indexedHash.clear();
    this.indexedText.clear();
    this.blockIds.clear();
    this.blocksByDoc.clear();
    this.indexMaps.clear();
    this.indexErrors.clear();
    this.syncIndexError();
    this.initialSweep = null;
    this.statusValue.ready = false;
    this.statusValue.indexing = null;
    this.emit();

    const delay = WORKER_RETRY_DELAYS[attempt];
    if (delay === undefined) {
      this.indexErrors.set("", "Search worker failed to load");
      this.syncIndexError();
      this.emit();

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    this.startWorker(attempt + 1);
    this.syncIndexed();
  }

  /** Asks the worker for the pages it already holds. */
  private syncIndexed(): void {
    this.worker?.postMessage({ type: "indexed" });
  }

  /** Marks pages whose metadata moved and pages the index still has. */
  private markChanged(): void {
    if (!this.indexedReady) return;

    const live = new Set<string>();

    for (const page of this.store.listPages()) {
      live.add(page.id);
      if (this.indexedAt.get(page.id) !== page.updatedAt) this.markDirty(page.id);
    }

    for (const docId of this.indexedAt.keys()) {
      if (!live.has(docId)) this.markDirty(docId);
    }
  }

  /**
   * Compares every page's current text with the hash the worker stored. This
   * is what catches text edited while the app was closed, since page text does
   * not move `PageMeta.updatedAt`.
   */
  private async markStartupChanged(): Promise<void> {
    const worker = this.worker;
    const pages = this.store.listPages();
    const live = new Set<string>();

    if (pages.length > 0) {
      this.statusValue.indexing = { done: 0, total: pages.length, reason: "checking" };
      this.emit();
    }

    for (const [index, page] of pages.entries()) {
      if (this.worker !== worker) return;

      live.add(page.id);
      try {
        const text = await this.store.loadPageText(page.id);
        if (
          this.indexedAt.get(page.id) !== page.updatedAt ||
          this.indexedHash.get(page.id) !== contentHash(text)
        ) {
          this.markDirty(page.id);
        }
      } catch {
        this.markDirty(page.id);
      }

      this.statusValue.indexing = { done: index + 1, total: pages.length, reason: "checking" };
      this.emit();
    }

    if (this.worker !== worker) return;

    for (const docId of this.indexedHash.keys()) {
      if (!live.has(docId)) this.markDirty(docId);
    }

    const total = this.pendingDocs.size;
    this.initialSweep = total > 0 ? "startup" : null;
    this.statusValue.indexing = total > 0 ? { done: 0, total, reason: "startup" } : null;
    this.emit();
  }

  /** Marks every page for a rebuild after the worker has wiped its tables. */
  private markAllPagesDirty(): void {
    for (const page of this.store.listPages()) this.markDirty(page.id);
  }

  private markDirty(docId: string): void {
    this.pendingDocs.add(docId);
    void this.flushIndexDebounced();
  }

  /**
   * Re-reads the synced search settings. The settings UI can flip semantic
   * search at any time. Indexing and queries branch on this flag, so a stale
   * value made the toggle a no-op until the app reloaded.
   */
  private refreshSettings(): void {
    const semantic = this.store.getSearchSettings().semantic;
    if (this.statusValue.semantic === semantic) return;

    this.statusValue.semantic = semantic;
    if (!semantic) {
      // Stored vectors stay for when it comes back.
      this.resetEmbedWorker();
    }
    this.emit();
  }

  /** Drops the model worker and resolves pending calls. It restarts on demand. */
  private resetEmbedWorker(): void {
    for (const resolve of this.embedPending.values()) resolve(null);
    this.embedPending.clear();
    this.embedWorker?.terminate();
    this.embedWorker = undefined;
    this.statusValue.model = "idle";
    this.statusValue.modelProgress = null;
    this.statusValue.error = null;
  }

  private async flushIndex(): Promise<void> {
    const batch = [...this.pendingDocs];
    this.pendingDocs.clear();
    if (batch.length === 0) {
      this.initialSweep = null;

      return;
    }

    const reason = this.initialSweep;
    this.typst ??= useTypst();
    const typstState = await this.typst;

    if (reason) {
      this.statusValue.indexing = { done: 0, total: batch.length, reason };
      this.emit();
    }

    for (const [index, docId] of batch.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await this.indexDoc(docId, typstState);

      if (reason) {
        this.statusValue.indexing = { done: index + 1, total: batch.length, reason };
        this.emit();
      }
    }

    if (reason) {
      this.initialSweep = null;
      this.statusValue.indexing = null;
      this.emit();
    }

    // The worker tracks the doc/block counts. Ask for a fresh status once the
    // batch is in so the settings panel reflects the index.
    this.worker?.postMessage({ type: "status" });
  }

  private async indexDoc(docId: string, typstState: TypstState): Promise<void> {
    if (docId === this.store.workspaceId) {
      // The workspace doc has metadata, not page content. Pages index it.
      await this.indexWorkspaceMeta(typstState);
      return;
    }

    const page = this.store.getPage(docId);
    if (!page) {
      this.worker?.postMessage({ type: "delete", docId });
      this.indexMaps.delete(docId);
      this.indexedText.delete(docId);
      this.indexedHash.delete(docId);
      this.blockIds.delete(docId);
      this.blocksByDoc.delete(docId);
      this.indexedAt.delete(docId);
      return;
    }

    const text = await this.store.loadPageText(docId);
    const hash = contentHash(text);

    const blocks = blocksOf(typstState, text) as unknown as IndexedBlock[];
    const byteOffsets = utf16ByteOffsets(text);
    const maps = new Map<number, Uint32Array>();
    for (const [i, block] of blocks.entries()) {
      maps.set(i, utf16MapForBlock(block, text, byteOffsets));
    }
    this.indexMaps.set(docId, maps);
    this.indexedText.set(docId, text);
    this.indexedAt.set(docId, page.updatedAt);
    this.indexedHash.set(docId, hash);
    // The worker answers with the row ids of the blocks it stored. The
    // embedding pass needs those, so it starts from the "upserted" reply.
    this.blocksByDoc.set(docId, blocks);

    this.worker?.postMessage({
      type: "upsert",
      docId,
      path: page.path,
      title: page.title,
      updatedAt: page.updatedAt,
      contentHash: hash,
      blocks,
    });
  }

  private async indexWorkspaceMeta(typstState: TypstState): Promise<void> {
    // No full-text content in the workspace doc. Page upserts keep the
    // pages table current.
    void typstState;
    this.emit();
  }

  /** Re-indexes and re-embeds everything (setting flip or model change). */
  async reembedAll(): Promise<void> {
    await this.rebuild();
  }

  private async embedAndStore(docId: string, blocks: IndexedBlock[]): Promise<void> {
    const rowIds = this.blockIds.get(docId);
    if (!rowIds || rowIds.length === 0 || !this.ensureEmbedWorker()) return;

    // The model takes a batch at a time. Long pages still get every block.
    const batch = 64;
    for (let start = 0; start < blocks.length; start += batch) {
      const chunk = blocks.slice(start, start + batch);
      // eslint-disable-next-line no-await-in-loop
      const vectors = await this.requestVectors(chunk.map((block) => block.plain));
      if (!vectors) return;

      for (let i = 0; i < chunk.length && i < vectors.length; i++) {
        // A newer upsert may have replaced these rows while the model was
        // busy. Drop the stale writes instead of re-adding orphan vectors.
        if (this.blockIds.get(docId) !== rowIds) return;

        const rowid = rowIds[start + i];
        // 0 marks a block the worker skipped (no plain text).
        if (rowid) {
          this.worker?.postMessage({
            type: "put-vector",
            blockId: rowid,
            vector: vectors[i],
          });
        }
      }
    }
  }

  private ensureEmbedWorker(): boolean {
    const settings = this.store.getSearchSettings();
    if (!settings.semantic) return false;

    if (!this.embedWorker) {
      const worker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), {
        type: "module",
      });
      this.embedWorker = worker;
      worker.addEventListener("message", (event: MessageEvent) => {
        const message = event.data as {
          id: number;
          type: string;
          vectors?: number[][];
          error?: string;
          progress?: number;
        };
        // Progress is not tied to a request. It keeps the panel's bar moving
        // while the first download runs.
        if (message.type === "progress") {
          this.statusValue.model = "downloading";
          if (typeof message.progress === "number") {
            this.statusValue.modelProgress = message.progress;
          }
          this.emit();
          return;
        }
        // Update the model state even when the caller stopped waiting, so a
        // slow first load still leaves the palette out of "loading".
        this.statusValue.model = message.type === "result" ? "ready" : "error";
        this.statusValue.modelProgress = null;
        this.statusValue.error = message.error ?? null;

        const entry = this.embedPending.get(message.id);
        if (entry) {
          this.embedPending.delete(message.id);
          entry(message.vectors ?? null);
        }
        this.emit();
      });
      worker.addEventListener("error", () => {
        // A worker that never loads would leave every embed call pending.
        for (const resolve of this.embedPending.values()) resolve(null);
        this.embedPending.clear();
        worker.terminate();
        if (this.embedWorker === worker) this.embedWorker = undefined;
        this.statusValue.model = "error";
        this.statusValue.error = "Embedding worker failed to load";
        this.emit();
      });
      this.statusValue.model = "downloading";
      this.statusValue.modelProgress = null;
      this.emit();
    }

    return true;
  }

  private requestVectors(texts: string[]): Promise<number[][] | null> {
    if (!this.embedWorker || texts.length === 0) return Promise.resolve(null);

    const id = ++this.embedSeq;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // The first call downloads the model, so give it room. A wedged load
        // would otherwise keep the indexing pass open forever.
        this.embedPending.delete(id);
        resolve(null);
      }, EMBED_TIMEOUT_MS);
      this.embedPending.set(id, (vectors) => {
        clearTimeout(timer);
        resolve(vectors);
      });
      this.embedWorker!.postMessage({
        id,
        type: "embed",
        texts,
        model: this.store.getSearchSettings().embeddingModel,
      });
    });
  }

  /** Full-text + optional semantic query, fused by reciprocal rank fusion. */
  async query(text: string, limit = MAX_HITS): Promise<SearchQueryResult> {
    if (!this.worker) return { items: [], loose: false };

    const query = text.trim();
    if (!query) return { items: [], loose: false };

    const textResult = await this.queryWorker<SearchHit[]>("query", {
      type: "query",
      text: query,
      limit,
    });
    const ftsHits = textResult.hits;

    let semanticHits: SearchHit[] = [];
    const mode = searchQueryMode(this.statusValue);
    if (mode === "hybrid") {
      const vectors = await this.requestVectors([query]);
      if (vectors?.[0]) {
        const semantic = await this.queryWorker<SearchHit[]>("semantic-query", {
          type: "semantic-query",
          vector: vectors[0],
          limit,
        });
        semanticHits = semantic.hits;
      }
    } else if (mode === "loading" && this.statusValue.model === "idle") {
      // Warm the model without delaying the text results. The next
      // keystroke can fuse once it reports ready.
      if (this.ensureEmbedWorker()) void this.requestVectors([query]);
    }

    const fused = this.fuse(ftsHits, semanticHits, limit);

    return {
      items: fused.map((hit) => this.toItem(hit)),
      loose: textResult.loose,
    };
  }

  private queryWorker<T>(
    channel: "query" | "semantic-query",
    request: unknown,
  ): Promise<{ hits: T; loose: boolean }> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (hits: T, loose = false) => {
        clearTimeout(timer);
        this.worker!.removeEventListener("message", onMessage);
        resolve({ hits, loose });
      };
      const onMessage = (event: MessageEvent) => {
        const message = event.data as {
          type?: string;
          hits?: T;
          loose?: boolean;
          error?: string;
          requestType?: string;
        };
        // A worker-side failure never produces a `channel` reply. Resolve
        // empty so the palette cannot hang on a broken index.
        if (message.type === "error" && message.requestType === channel) {
          finish([] as T);
          return;
        }
        if (message.type !== channel) return;
        if (message.error) {
          finish([] as T);
          return;
        }

        finish(message.hits as T, message.loose ?? false);
      };
      // A stopped or crashed worker would otherwise leave the palette on
      // "Searching..." forever.
      timer = setTimeout(() => finish([] as T), QUERY_TIMEOUT_MS);
      this.worker!.addEventListener("message", onMessage);
      this.worker!.postMessage(request);
    });
  }

  private fuse(
    fts: SearchHit[],
    semantic: SearchHit[],
    limit: number,
  ): Array<SearchHit & { combined: number; snippet: SnippetSegment[] }> {
    type Fused = SearchHit & { combined: number; snippet: SnippetSegment[] };
    const map = new Map<string, Fused>();

    const add = (hit: SearchHit, rank: number, kind: "fts" | "sem") => {
      const key = `${hit.docId}:${hit.blockIndex}`;
      const existing = map.get(key);
      const score = 1 / (60 + rank);
      if (existing) {
        if (kind === "fts") existing.bm25 = hit.bm25;
        else existing.semantic = hit.semantic ?? existing.semantic;
        existing.combined += score;
      } else {
        map.set(key, {
          ...hit,
          combined: score,
          snippet: this.snippetFor(hit),
        });
      }
    };

    fts.forEach((hit, index) => add(hit, index, "fts"));
    semantic.forEach((hit, index) => add(hit, index, "sem"));

    return [...map.values()].sort((a, b) => b.combined - a.combined).slice(0, limit);
  }

  private snippetFor(hit: SearchHit): SnippetSegment[] {
    // FTS offsets count UTF-8 bytes, so slice the encoded text and decode.
    const bytes = this.encoder.encode(hit.plain);
    const [first] = hit.offsets;
    const from = first ? Math.max(0, first[0] - 24) : 0;
    const to = first ? Math.min(bytes.length, first[1] + 60) : Math.min(bytes.length, 120);

    const segments: SnippetSegment[] = [];
    if (from > 0) segments.push({ text: "...", match: false });

    let cursor = from;
    for (const [start, end] of hit.offsets) {
      const matchStart = Math.max(start, from);
      const matchEnd = Math.min(end, to);
      if (matchEnd <= matchStart) continue;

      if (matchStart > cursor) {
        segments.push({
          text: this.decoder.decode(bytes.subarray(cursor, matchStart)),
          match: false,
        });
      }
      segments.push({
        text: this.decoder.decode(bytes.subarray(matchStart, matchEnd)),
        match: true,
      });
      cursor = matchEnd;
    }

    if (cursor < to) {
      segments.push({ text: this.decoder.decode(bytes.subarray(cursor, to)), match: false });
    }
    if (to < bytes.length) segments.push({ text: "...", match: false });

    return segments;
  }

  private toItem(
    hit: SearchHit & { snippet: SnippetSegment[]; combined: number },
  ): SearchResultItem {
    let rawRange: SearchResultItem["rawRange"] = null;
    const [first] = hit.offsets;
    const maps = this.indexMaps.get(hit.docId);
    if (first && maps) {
      const map = maps.get(hit.blockIndex);
      if (map) {
        const text = this.indexedText.get(hit.docId) ?? "";
        const from = map[first[0]];
        const to = rawEndForByte(map, text, first[1]);
        if (from !== undefined && to > from) rawRange = { from, to };
      }
    }

    // Semantic hits have no FTS offsets. Reveal the block they came from
    // instead of opening the page with no visible location.
    if (!rawRange) {
      const map = maps?.get(hit.blockIndex);
      if (map && map.length > 1) {
        const from = map[0];
        const to = map[map.length - 1];
        if (from !== undefined && to !== undefined && to > from) rawRange = { from, to };
      }
    }

    return {
      docId: hit.docId,
      path: hit.path,
      title: hit.title,
      blockIndex: hit.blockIndex,
      kind: hit.kind,
      snippet: hit.snippet,
      rawRange,
      offsets: hit.offsets,
      bm25: hit.bm25,
      semantic: hit.semantic ?? null,
      score: hit.combined,
    };
  }

  /**
   * Resolves a hit's source range on demand. A warm index has no block maps
   * in memory, so the first click parses the page instead of opening it with
   * no cursor or highlight.
   */
  async resolveRange(item: SearchResultItem): Promise<{ from: number; to: number } | null> {
    if (item.rawRange) return item.rawRange;

    let text = this.indexedText.get(item.docId);
    let maps = this.indexMaps.get(item.docId);

    if (!text || !maps) {
      try {
        text = await this.store.loadPageText(item.docId);
        this.typst ??= useTypst();
        const typstState = await this.typst;
        const blocks = blocksOf(typstState, text) as unknown as IndexedBlock[];
        const byteOffsets = utf16ByteOffsets(text);
        maps = new Map<number, Uint32Array>();
        for (const [index, block] of blocks.entries()) {
          maps.set(index, utf16MapForBlock(block, text, byteOffsets));
        }
        this.indexMaps.set(item.docId, maps);
        this.indexedText.set(item.docId, text);
      } catch {
        return null;
      }
    }

    if (!text || !maps) return null;

    const map = maps.get(item.blockIndex);
    if (!map) return null;

    const [first] = item.offsets;
    if (first) {
      const from = map[first[0]];
      const to = rawEndForByte(map, text, first[1]);
      if (from !== undefined && to > from) {
        item.rawRange = { from, to };

        return item.rawRange;
      }
    }

    if (map.length > 1) {
      const from = map[0];
      const to = map[map.length - 1];
      if (from !== undefined && to !== undefined && to > from) {
        item.rawRange = { from, to };

        return item.rawRange;
      }
    }

    return null;
  }

  async rebuild(): Promise<void> {
    this.refreshSettings();
    if (this.statusValue.semantic) {
      // Fresh attempt: a failed or half-loaded model gets another chance.
      this.resetEmbedWorker();
    }
    this.indexErrors.clear();
    this.syncIndexError();
    this.worker?.postMessage({ type: "wipe" });
    this.indexMaps.clear();
    this.indexedText.clear();
    this.blocksByDoc.clear();
    this.blockIds.clear();
    this.indexedAt.clear();
    this.indexedHash.clear();

    const pages = this.store.listPages().length;
    this.initialSweep = pages > 0 ? "rebuild" : null;
    this.statusValue.indexing = pages > 0 ? { done: 0, total: pages, reason: "rebuild" } : null;
    this.emit();
    this.markAllPagesDirty();
  }

  /** Restarts the index worker after a load failure. */
  restart(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.indexedReady = false;
    this.indexedAt.clear();
    this.indexedHash.clear();
    this.indexedText.clear();
    this.blockIds.clear();
    this.blocksByDoc.clear();
    this.indexMaps.clear();
    this.indexErrors.clear();
    this.syncIndexError();
    this.initialSweep = null;
    this.statusValue.ready = false;
    this.statusValue.indexing = null;
    this.emit();
    this.startWorker();
    this.syncIndexed();
  }

  /** Terminates both workers. Called when the shared composable disposes. */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.embedWorker?.terminate();
    this.embedWorker = undefined;
    this.initialSweep = null;
    this.statusValue.indexing = null;
  }

  private handleWorkerMessage(message: {
    type: string;
    status?: IndexStatus;
    pages?: Array<{ docId: string; updatedAt: number; hash: string }>;
    blockIds?: number[];
    docId?: string;
    requestType?: string;
    error?: string;
  }): void {
    if (message.type === "indexed" && message.pages) {
      this.indexedAt = new Map(message.pages.map((page) => [page.docId, page.updatedAt]));
      this.indexedHash = new Map(message.pages.map((page) => [page.docId, page.hash]));
      this.indexedReady = true;
      void this.markStartupChanged();
    }
    if (message.type === "status" && message.status) {
      this.statusValue.ready = true;
      this.statusValue.mode = message.status.mode;
      this.statusValue.docs = message.status.docs;
      this.statusValue.blocks = message.status.blocks;
      this.statusValue.vecReady = message.status.vecReady;
      this.emit();
    }
    // Query failures are transient and resolve through `queryWorker`. Only
    // indexing and init failures belong in the status.
    const queryRequest =
      message.requestType === "query" || message.requestType === "semantic-query";
    if (message.type === "error" && message.error && !queryRequest) {
      this.indexErrors.set(message.docId ?? "", message.error);
      this.syncIndexError();
      this.emit();
    }
    if (message.type === "upserted" && message.docId && message.blockIds) {
      if (this.indexErrors.delete(message.docId)) this.syncIndexError();
      this.blockIds.set(message.docId, message.blockIds);

      const blocks = this.blocksByDoc.get(message.docId);
      this.blocksByDoc.delete(message.docId);
      if (this.statusValue.semantic && blocks) {
        void this.embedAndStore(message.docId, blocks);
      }
    }
  }

  private syncIndexError(): void {
    const [first] = this.indexErrors.values();
    this.statusValue.indexError = first ?? null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
