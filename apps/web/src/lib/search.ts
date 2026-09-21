import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";

import type { IndexedBlock, IndexStatus, SearchHit } from "~/workers/index.worker";

import { useTypst } from "~/composables/typst";

/**
 * Search manager: owns the index worker connection, feeds it flattened
 * blocks from the wasm syntax pass, and answers palette queries with a
 * hybrid (BM25 + optional semantic) merge. Indexing is incremental off the
 * store's commit batches, debounced, one transaction per page.
 */

export interface SearchResultItem {
  docId: string;
  path: string;
  title: string;
  blockIndex: number;
  kind: string;
  /** Snippet with [[ ]] highlights from FTS. */
  snippet: string;
  /** Raw source range for the best hit in the block. */
  rawRange: { from: number; to: number } | null;
  bm25: number | null;
  semantic: number | null;
}

export interface SearchStatus {
  ready: boolean;
  mode: "opfs" | "memory" | "starting";
  docs: number;
  blocks: number;
  semantic: boolean;
  /** sqlite-vec is present in this build; semantic queries need it. */
  vecReady: boolean;
  model: "idle" | "downloading" | "ready" | "error";
  error: string | null;
  /** Last index worker failure; indexing is broken while this is set. */
  indexError: string | null;
}

const INDEX_DEBOUNCE_MS = 2000;
const QUERY_TIMEOUT_MS = 8000;
const MAX_HITS = 24;

export type SearchQueryMode = "text" | "hybrid" | "loading" | "unavailable";

/** Text search always runs; semantic only fuses in when the model is ready. */
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
  private indexMaps = new Map<string, Map<number, Uint8Array>>();
  /** Blocks from the last upsert, waiting for the worker's row ids. */
  private blocksByDoc = new Map<string, IndexedBlock[]>();
  private blockIds = new Map<string, number[]>();
  /** Last indexed `PageMeta.updatedAt`, so settings writes don't re-embed. */
  private indexedAt = new Map<string, number>();
  private indexErrors = new Map<string, string>();
  // FTS offsets are UTF-8 byte offsets; snippets need the decoded text back.
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  // Debounce via the global useDebounceFn; outside a component scope it never
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
    error: null,
    indexError: null,
  };
  private listeners = new Set<() => void>();
  private typst: Promise<TypstState> | undefined;

  constructor(private readonly store: WorkspaceStore) {}

  /** The workspace this index belongs to; switches rebuild the manager. */
  get workspaceId(): string {
    return this.store.workspaceId;
  }

  get status(): SearchStatus {
    return this.statusValue;
  }

  async start(): Promise<void> {
    this.worker = new Worker(new URL("../workers/index.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent) =>
      this.handleWorkerMessage(event.data),
    );

    this.worker.postMessage({ type: "init", dbName: this.store.workspaceId });

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

      const live = new Set<string>();
      for (const page of this.store.listPages()) {
        live.add(page.id);
        if (this.indexedAt.get(page.id) !== page.updatedAt) this.markDirty(page.id);
      }
      // Pages that disappeared still have index rows; marking them dirty
      // routes through the delete branch in `indexDoc`.
      for (const docId of this.indexedAt.keys()) {
        if (!live.has(docId)) this.markDirty(docId);
      }
      this.emit();
    });

    // Initial sweep: index every doc the first time, cursors live in the
    // store's local state? No: search freshness is per-device honest by
    // re-indexing anything that changed since the last local build.
    for (const docId of await this.store.listDocIds()) {
      this.markDirty(docId);
    }
  }

  private markDirty(docId: string): void {
    this.pendingDocs.add(docId);
    void this.flushIndexDebounced();
  }

  /**
   * Re-reads the synced search settings. The settings UI can flip semantic
   * search at any time; indexing and queries branch on this flag, so a stale
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

  /** Drops the model worker and resolves pending calls; it restarts on demand. */
  private resetEmbedWorker(): void {
    for (const resolve of this.embedPending.values()) resolve(null);
    this.embedPending.clear();
    this.embedWorker?.terminate();
    this.embedWorker = undefined;
    this.statusValue.model = "idle";
    this.statusValue.error = null;
  }

  private async flushIndex(): Promise<void> {
    const batch = [...this.pendingDocs];
    this.pendingDocs.clear();

    this.typst ??= useTypst();
    const typstState = await this.typst;

    for (const docId of batch) {
      // eslint-disable-next-line no-await-in-loop
      await this.indexDoc(docId, typstState);
    }

    // The worker owns the doc/block counts; ask for a fresh status once the
    // batch is in so the settings panel reflects the index.
    this.worker?.postMessage({ type: "status" });
  }

  private async indexDoc(docId: string, typstState: TypstState): Promise<void> {
    if (docId === this.store.workspaceId) {
      // The workspace doc holds metadata, not page content; pages index it.
      await this.indexWorkspaceMeta(typstState);
      return;
    }

    const page = this.store.getPage(docId);
    if (!page) {
      this.worker?.postMessage({ type: "delete", docId });
      this.indexMaps.delete(docId);
      this.blockIds.delete(docId);
      this.blocksByDoc.delete(docId);
      this.indexedAt.delete(docId);
      return;
    }

    const text = await this.store.loadPageText(docId);

    const blocks = typstState.flattenDocument(text) as unknown as IndexedBlock[];
    const maps = new Map<number, Uint8Array>();
    for (const [i, block] of blocks.entries()) {
      const map = new Uint8Array(new Uint32Array(block.map).buffer);
      maps.set(i, map);
    }
    this.indexMaps.set(docId, maps);
    this.indexedAt.set(docId, page.updatedAt);
    // The worker answers with the row ids of the blocks it stored; the
    // embedding pass needs those, so it starts from the "upserted" reply.
    this.blocksByDoc.set(docId, blocks);

    this.worker?.postMessage({
      type: "upsert",
      docId,
      path: page.path,
      title: page.title,
      updatedAt: page.updatedAt,
      blocks,
    });
  }

  private async indexWorkspaceMeta(typstState: TypstState): Promise<void> {
    // No full-text content in the workspace doc; page upserts keep the
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

    // The model takes a batch at a time; long pages still get every block.
    const batch = 64;
    for (let start = 0; start < blocks.length; start += batch) {
      const chunk = blocks.slice(start, start + batch);
      // eslint-disable-next-line no-await-in-loop
      const vectors = await this.requestVectors(chunk.map((block) => block.plain));
      if (!vectors) return;

      for (let i = 0; i < chunk.length && i < vectors.length; i++) {
        // A newer upsert may have replaced these rows while the model was
        // busy; drop the stale writes instead of re-adding orphan vectors.
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
      this.embedWorker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), {
        type: "module",
      });
      this.embedWorker.addEventListener("message", (event: MessageEvent) => {
        const message = event.data as {
          id: number;
          type: string;
          vectors?: number[][];
          error?: string;
        };
        const entry = this.embedPending.get(message.id);
        if (!entry) return;

        this.embedPending.delete(message.id);
        this.statusValue.model = message.type === "result" ? "ready" : "error";
        this.statusValue.error = message.error ?? null;
        entry(message.vectors ?? null);
        this.emit();
      });
      this.statusValue.model = "downloading";
      this.emit();
    }

    return true;
  }

  private requestVectors(texts: string[]): Promise<number[][] | null> {
    if (!this.embedWorker || texts.length === 0) return Promise.resolve(null);

    const id = ++this.embedSeq;

    return new Promise((resolve) => {
      this.embedPending.set(id, resolve);
      this.embedWorker!.postMessage({
        id,
        type: "embed",
        texts,
        model: this.store.getSearchSettings().embeddingModel,
      });
    });
  }

  /** Full-text + optional semantic query, fused by reciprocal rank fusion. */
  async query(text: string, limit = MAX_HITS): Promise<SearchResultItem[]> {
    if (!this.worker) return [];

    const query = text.trim();
    if (!query) return [];

    const ftsHits = await this.queryWorker<SearchHit[]>("query", {
      type: "query",
      text: query,
      limit: MAX_HITS,
    });

    let semanticHits: SearchHit[] = [];
    const mode = searchQueryMode(this.statusValue);
    if (mode === "hybrid") {
      const vectors = await this.requestVectors([query]);
      if (vectors?.[0]) {
        semanticHits = await this.queryWorker<SearchHit[]>("semantic-query", {
          type: "semantic-query",
          vector: vectors[0],
          limit: MAX_HITS,
        });
      }
    } else if (mode === "loading" && this.statusValue.model === "idle") {
      // Warm the model without holding up the text results; the next
      // keystroke can fuse once it reports ready.
      if (this.ensureEmbedWorker()) void this.requestVectors([query]);
    }

    const fused = this.fuse(ftsHits, semanticHits, limit);

    return fused.map((hit) => this.toItem(hit));
  }

  private queryWorker<T>(channel: "query" | "semantic-query", request: unknown): Promise<T> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: T) => {
        clearTimeout(timer);
        this.worker!.removeEventListener("message", onMessage);
        resolve(value);
      };
      const onMessage = (event: MessageEvent) => {
        const message = event.data as {
          type?: string;
          hits?: T;
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

        finish(message.hits as T);
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
  ): Array<SearchHit & { combined: number; snippet: string }> {
    type Fused = SearchHit & { combined: number; snippet: string };
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

  private snippetFor(hit: SearchHit): string {
    // FTS offsets count UTF-8 bytes, so slice the encoded text and decode.
    const bytes = this.encoder.encode(hit.plain);
    const [first] = hit.offsets;
    if (!first) return this.decoder.decode(bytes.subarray(0, 120));

    const from = Math.max(0, first[0] - 24);
    const to = Math.min(bytes.length, first[1] + 60);

    return `${from > 0 ? "..." : ""}${this.decoder.decode(bytes.subarray(from, to))}${
      to < bytes.length ? "..." : ""
    }`;
  }

  private toItem(hit: SearchHit & { snippet: string }): SearchResultItem {
    let rawRange: SearchResultItem["rawRange"] = null;
    const [first] = hit.offsets;
    const maps = this.indexMaps.get(hit.docId);
    if (first && maps) {
      const map = maps.get(hit.blockIndex);
      if (map) {
        const u32 = new Uint32Array(map.buffer, map.byteOffset, map.byteLength / 4);
        const from = u32[Math.min(first[0], u32.length - 1)];
        const to = u32[Math.min(first[1] - 1, u32.length - 1)];
        if (from !== undefined && to !== undefined) {
          rawRange = { from, to: to + 1 };
        }
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
      bm25: hit.bm25,
      semantic: hit.semantic ?? null,
    };
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
    this.blocksByDoc.clear();
    this.blockIds.clear();
    this.indexedAt.clear();
    for (const docId of await this.store.listDocIds()) this.markDirty(docId);
  }

  /** Terminates both workers. Called when the shared composable disposes. */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.embedWorker?.terminate();
    this.embedWorker = undefined;
  }

  private handleWorkerMessage(message: {
    type: string;
    status?: IndexStatus;
    blockIds?: number[];
    docId?: string;
    requestType?: string;
    error?: string;
  }): void {
    if (message.type === "status" && message.status) {
      this.statusValue.ready = true;
      this.statusValue.mode = message.status.mode;
      this.statusValue.docs = message.status.docs;
      this.statusValue.blocks = message.status.blocks;
      this.statusValue.vecReady = message.status.vecReady;
      this.emit();
    }
    // Query failures are transient and resolve through `queryWorker`; only
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
